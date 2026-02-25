import { DynamoDBStreamEvent, DynamoDBRecord } from 'aws-lambda';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import log4js = require('log4js');

log4js.configure({
  appenders: { out: { type: 'stdout' } },
  categories: { default: { appenders: ['out'], level: process.env.LOG_LEVEL || 'info' } }
});

const logger = log4js.getLogger('notifier-stream-processor');

const snsClient = new SNSClient({});
const sqsClient = new SQSClient({});
const TOPIC_ARN = process.env.TOPIC_ARN!;
const AUTHORIZER_QUEUE_URL = process.env.AUTHORIZER_QUEUE_URL!;

export const handler = async (event: DynamoDBStreamEvent): Promise<void> => {
  logger.info('Processing DynamoDB Stream event', JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (error) {
      logger.error('Error processing record:', error);
      throw error;
    }
  }
};

async function processRecord(record: DynamoDBRecord): Promise<void> {
   // Get table name from ARN
  const eventSourceARN = record.eventSourceARN;
  const tableName = eventSourceARN?.split(':table/')[1]?.split('/stream')[0];

  logger.info('Event triggered from table:', tableName);
  logger.info('Record event name:', record.eventName);
  // Only process MODIFY events
  if (record.eventName !== 'MODIFY') {
    logger.info('Skipping non-MODIFY event:', record.eventName);
    return;
  }

  const oldImage = record.dynamodb?.OldImage;
  const newImage = record.dynamodb?.NewImage;

  if (!oldImage || !newImage) {
    logger.warn('Missing old or new image');
    return;
  }

  // Unmarshall the DynamoDB records
  const oldData = unmarshall(oldImage as any);
  const newData = unmarshall(newImage as any);

  const oldStatus = oldData.status;
  const newStatus = newData.status;

  logger.info(`Status change: ${oldStatus} -> ${newStatus}`);

  if ((newStatus === 'RECEIVED' || newStatus === 'PROCESSING') && oldStatus !== newStatus) {
    if (!newData.accessKey) {
      logger.warn('Skipping SQS publish: missing accessKey in DynamoDB NewImage', {
        tableName,
        eventID: record.eventID,
      });
      return;
    }

    logger.info(`Status changed to ${newStatus}, publishing to SQS authorizer queue`);
    await publishToAuthorizerQueue(newData, tableName);
  }

  // Check if status changed from RECEIVED or PROCESSING to AUTHORIZED
  if ((oldStatus === 'RECEIVED' || oldStatus === 'PROCESSING') && newStatus === 'AUTHORIZED') {
    if (!newData.accessKey || !newData.status) {
      logger.warn('Skipping SNS publish: missing required fields in DynamoDB NewImage', {
        tableName,
        eventID: record.eventID,
        hasAccessKey: Boolean(newData.accessKey),
        hasStatus: Boolean(newData.status),
      });
      return;
    }

    logger.info(`Status changed from ${oldStatus} to ${newStatus}, publishing to SNS`);
    await publishToSns(newData, tableName);
  }
}

async function publishToSns(data: any, tableName: string = 'prd-facturero-sri-vouchers' ): Promise<void> {
  const message = {
    eventType: 'STATUS_CHANGE',
    status: data.status,
    accessKey: data.accessKey,
    timestamp: new Date().toISOString()
  };

  const command = new PublishCommand({
    TopicArn: TOPIC_ARN,
    Message: JSON.stringify(message),
    MessageAttributes: {
      eventType: {
        DataType: 'String',
        StringValue: 'STATUS_CHANGE'
      },
      status: {
        DataType: 'String',
        StringValue: data.status
      }
    }
  });

  const result = await snsClient.send(command);
  logger.info('SNS message published:', result.MessageId);
}

async function publishToAuthorizerQueue(data: any, tableName: string = 'prd-facturero-sri-vouchers'): Promise<void> {
  const message = {
    accessKey: data.accessKey,
    tableName,
    eventType: 'AUTHORIZE_VOUCHER',
    timestamp: new Date().toISOString()
  };

  const command = new SendMessageCommand({
    QueueUrl: AUTHORIZER_QUEUE_URL,
    MessageBody: JSON.stringify(message)
  });

  const result = await sqsClient.send(command);
  logger.info('SQS message published:', result.MessageId);
}
