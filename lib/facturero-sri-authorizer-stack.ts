import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as path from 'path';

export class FactureroSriAuthorizerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const voucherTableName = 'prd-facturero-sri-vouchers';

    const voucherTable = dynamodb.Table.fromTableName(
      this,
      'VoucherAuthorizationTable',
      voucherTableName
    );

    // Dead Letter Queue
    const deadLetterQueue = new sqs.Queue(this, 'SriAuthorizerDLQ', {
      queueName: 'sri-authorizer-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    // Main SQS Queue with DLQ configuration
    const authorizerQueue = new sqs.Queue(this, 'SriAuthorizerQueue', {
      queueName: 'sri-authorizer-queue',
      visibilityTimeout: cdk.Duration.seconds(120),
      deadLetterQueue: {
        queue: deadLetterQueue,
        maxReceiveCount: 3, // Retry 3 times before sending to DLQ
      },
    });

    // Lambda function to process authorization
    const authorizerFunction = new lambda.Function(this, 'SriAuthorizerFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/authorizer')),
      timeout: cdk.Duration.seconds(60),
      environment: {
        TABLE_NAME: voucherTable.tableName,
        SRI_ENDPOINT: process.env.SRI_ENDPOINT || 'https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl',
        SRI_TEST_ENDPOINT: process.env.SRI_TEST_ENDPOINT || 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl'
      },
    });

    // Grant permissions
    voucherTable.grantReadWriteData(authorizerFunction);
    authorizerQueue.grantConsumeMessages(authorizerFunction);
    deadLetterQueue.grantSendMessages(authorizerFunction);

    // Add SQS as event source for Lambda
    authorizerFunction.addEventSource(
      new lambdaEventSources.SqsEventSource(authorizerQueue, {
        batchSize: 1,
        reportBatchItemFailures: true,
      })
    );

    // Outputs
    new cdk.CfnOutput(this, 'QueueURL', {
      value: authorizerQueue.queueUrl,
      description: 'SRI Authorizer Queue URL',
    });

    new cdk.CfnOutput(this, 'DLQueueURL', {
      value: deadLetterQueue.queueUrl,
      description: 'Dead Letter Queue URL',
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: voucherTable.tableName,
      description: 'Voucher Authorization Table Name',
    });
  }
}
