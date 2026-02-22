import type { SQSHandler, SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Client, createClientAsync } from 'soap';
import { SriEnv, VoucherStatus, IVoucherId, IVoucher, VoucherMessage } from './types';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});

const TABLE_NAME = process.env.TABLE_NAME;
const BUCKET_NAME = process.env.BUCKET_NAME;
const SRI_AUTH_ENDPOINT = process.env.SRI_ENDPOINT || 'https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl';
const SRI_AUTH_TEST_ENDPOINT = process.env.SRI_TEST_ENDPOINT || 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl';


/**
 * Update voucher status in DynamoDB
 */
async function updateVoucherStatus(
    companyId: string,
    voucherId: IVoucherId,
    status: VoucherStatus,
    messages?: any
): Promise<void> {
    const {voucherType, environment, establishment, branch, sequence} = voucherId;
    const params = {
        TableName: TABLE_NAME,
        Key: { companyId, voucherId: `#${voucherType}#${environment}#${establishment}#${branch}#${sequence}` },
        UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt, messages = :messages',
        ExpressionAttributeNames: {
            '#status': 'status',
        },
        ExpressionAttributeValues: {
            ':status': status,
            ':updatedAt': new Date().toISOString(),
            ':messages': messages || {},
        },
    };

    await docClient.send(new UpdateCommand(params));
}

async function getVoucherStatus(companyId: string, voucherId: IVoucherId): Promise<IVoucher | null> {
    const {voucherType, environment, establishment, branch, sequence} = voucherId;
    const params = {
        TableName: TABLE_NAME,
        Key: { companyId, voucherId: `#${voucherType}#${environment}#${establishment}#${branch}#${sequence}` },
        ProjectionExpression: '#status',
        ExpressionAttributeNames: {
            '#status': 'status',
        },
    };

    const result = await docClient.send(new GetCommand(params));
    return result.Item as IVoucher || null;
}

/**
 * Call SRI SOAP service for authorization
 */
async function authorizeSriVoucher(accessKey: string, environment: SriEnv): Promise<{ authorized: boolean; details: any }> {
    try {
        const endpoint = environment === SriEnv.TEST ? SRI_AUTH_TEST_ENDPOINT : SRI_AUTH_ENDPOINT;
        const client: Client = await createClientAsync(endpoint);

        // Call the SOAP method for authorization
        const [result, rawResponse] = await client.autorizacionComprobanteAsync({ claveAccesoComprobante: accessKey });

        console.log('Resultado de autorización: ', result, 'Respuesta cruda: ', rawResponse);

        // Parse the response
        if (result?.RespuestaAutorizacionComprobante) {
            const autorizaciones = result.RespuestaAutorizacionComprobante.autorizaciones?.autorizacion;

            if (autorizaciones && autorizaciones.length > 0) {
                const autorizacion = Array.isArray(autorizaciones) ? autorizaciones[0] : autorizaciones;
                const estado = autorizacion.estado;
                const messages = autorizacion.mensajes instanceof Array ? autorizacion.mensajes : [autorizacion.mensajes];
                return {
                    authorized: estado === 'AUTORIZADO',
                    details: {
                        status: estado,
                        voucher: autorizacion.comprobante,
                        authorizationDate: autorizacion.fechaAutorizacion,
                        messages: messages,
                    },
                };
            }
        }

        // If no clear authorization response, consider it not authorized
        return {
            authorized: false,
            details: result,
        };
    } catch (error: any) {
        console.error('Error calling SRI service:', error);
        throw new Error(`SRI service error: ${error.message}`);
    }
}

async function storeAuthorizedVoucherXml(companyId: string, accessKey: string, voucherXml: string): Promise<void> {
    if (!BUCKET_NAME) {
        console.warn('Skipping XML upload: BUCKET_NAME is not configured');
        return;
    }

    const key = `${companyId}/autorizados/${accessKey}_aut.xml`;

    await s3Client.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: voucherXml,
        ContentType: 'application/xml; charset=utf-8',
    }));

    console.log(`Authorized XML stored in s3://${BUCKET_NAME}/${key}`);
}

/**
 * Process a single voucher authorization
 */
async function processVoucher(message: VoucherMessage): Promise<void> {
    const { accessKey } = message;
    console.log(`Processing voucher with accessKey: ${accessKey}`);

    const companyId = getCompanyIdFromAccessKey(accessKey);
    const voucherId = getVoucherKeyFromAccessKey(accessKey);

    const currentVoucher = await getVoucherStatus(companyId, voucherId);

    if (!currentVoucher) {
        console.error(`Voucher not found for accessKey: ${accessKey}`);
        throw new Error(`Voucher not found for accessKey: ${accessKey}`);
    }

    // Update status to PROCESSING
    await updateVoucherStatus(companyId, voucherId, VoucherStatus.PROCESSING);

    try {
        // Call SRI authorization service
        const { authorized, details } = await authorizeSriVoucher(accessKey, voucherId.environment);

        if (authorized && details?.voucher) {
            await storeAuthorizedVoucherXml(companyId, accessKey, details.voucher);
        }

        // Update status based on authorization result
        const status = authorized ? VoucherStatus.AUTHORIZED : VoucherStatus.NOT_AUTHORIZED;
        await updateVoucherStatus(companyId, voucherId, status, details);

        console.log(`Voucher ${accessKey} status: ${status}`);
    } catch (error: any) {
        console.error(`Error processing voucher ${accessKey}:`, error);
        // Re-throw the error so SQS will retry
        throw error;
    }
}


const getCompanyIdFromAccessKey = (accessKey: string): string => {
    return accessKey.substring(10, 23);
}

const getVoucherKeyFromAccessKey = (accessKey: string): IVoucherId => {

    const voucherTypeCode = accessKey.substring(8, 10);
    const environment = accessKey.substring(23, 24) === '1' ? SriEnv.TEST : SriEnv.PRODUCTION;
    const estab = accessKey.substring(24, 27);
    const ptoEmi = accessKey.substring(27, 30);
    const secuencial = accessKey.substring(30, 39);

    return {
        voucherType: voucherTypeCode,
        environment: environment,
        establishment: estab,
        branch: ptoEmi,
        sequence: secuencial
    } as IVoucherId;
}

/**
 * Lambda handler for SQS events
 */
export const handler: SQSHandler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
    console.log('Received SQS event:', JSON.stringify(event));

    const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

    for (const record of event.Records) {
        try {
            const message: VoucherMessage = JSON.parse(record.body);
            await processVoucher(message);
        } catch (error: any) {
            console.error(`Failed to process message ${record.messageId}:`, error);

            // Add to batch item failures to retry
            batchItemFailures.push({
                itemIdentifier: record.messageId,
            });
        }
    }

    return { batchItemFailures };
};
