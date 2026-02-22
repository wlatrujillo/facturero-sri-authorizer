import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as path from 'path';

export class FactureroSriAuthorizerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    cdk.Tags.of(this).add('Module', 'facturero-sri');

    const environmentId = process.env.ENVIRONMENT_ID || 'dev';
    const voucherTableName = `${environmentId}-facturero-sri-vouchers`;
    const voucherBucketName = `${environmentId}-facturero-sri-vouchers`;

    const voucherTable = dynamodb.Table.fromTableName(
      this,
      `${environmentId}-VoucherAuthorizationTable`,
      voucherTableName
    );

    const voucherBucket = s3.Bucket.fromBucketName(
      this,
      `${environmentId}-VoucherBucket`,
      voucherBucketName
    );

    // Dead Letter Queue
    const deadLetterQueue = new sqs.Queue(this, `${environmentId}-FactureroSriAuthorizerDLQ`, {
      queueName: `${environmentId}-facturero-sri-authorizer-dlq`,
      retentionPeriod: cdk.Duration.days(14),
    });

    // Main SQS Queue with DLQ configuration
    const authorizerQueue = new sqs.Queue(this, `${environmentId}-FactureroSriAuthorizerQueue`, {
      queueName: `${environmentId}-facturero-sri-authorizer-queue`,
      visibilityTimeout: cdk.Duration.seconds(120),
      deadLetterQueue: {
        queue: deadLetterQueue,
        maxReceiveCount: 3, // Retry 3 times before sending to DLQ
      },
    });

    // Lambda function to process authorization
    const authorizerFunction = new lambda.Function(this, `${environmentId}-FactureroSriAuthorizerFunction`, {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/authorizer')),
      timeout: cdk.Duration.seconds(60),
      environment: {
        TABLE_NAME: voucherTable.tableName,
        BUCKET_NAME: voucherBucket.bucketName,
        SRI_ENDPOINT: process.env.SRI_ENDPOINT || 'https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl',
        SRI_TEST_ENDPOINT: process.env.SRI_TEST_ENDPOINT || 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl'
      },

    });

    // Grant permissions
    voucherTable.grantReadWriteData(authorizerFunction);
    voucherBucket.grantPut(authorizerFunction);
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
    new cdk.CfnOutput(this, `${environmentId}-FactureroSriAuthorizerQueueURL`, {
      value: authorizerQueue.queueUrl,
      description: 'SRI Authorizer Queue URL',
    });

    new cdk.CfnOutput(this, `${environmentId}-FactureroSriAuthorizerDLQueueURL`, {
      value: deadLetterQueue.queueUrl,
      description: 'Dead Letter Queue URL',
    });

    new cdk.CfnOutput(this, `${environmentId}-FactureroSriAuthorizerTableName`, {
      value: voucherTable.tableName,
      description: 'Voucher Authorization Table Name',
    });
  }
}
