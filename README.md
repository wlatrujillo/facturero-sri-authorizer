# SRI Voucher Authorizer

AWS CDK project for authorizing electronic vouchers with Ecuador's SRI (Servicio de Rentas Internas) using a serverless architecture.

## Architecture

This project implements a fault-tolerant authorization system with the following components:

- **SQS Queue**: Receives voucher authorization requests
- **Lambda Function**: Processes messages and calls SRI SOAP service
- **DynamoDB Table**: Stores authorization status (PROCESSING, AUTHORIZED, NOT_AUTHORIZED)
- **Dead Letter Queue**: Captures failed messages after 3 retry attempts

### Flow

1. Message with `accessKey` is sent to SQS queue
2. Lambda function is triggered and updates DynamoDB status to `PROCESSING`
3. Lambda calls SRI SOAP web service for authorization
4. Status is updated to `AUTHORIZED` or `NOT_AUTHORIZED` based on response
5. If processing fails, message is retried up to 3 times
6. After 3 failures, message moves to Dead Letter Queue

## Prerequisites

- Node.js 20.x or later
- AWS CDK CLI (`npm install -g aws-cdk`)
- AWS Account and credentials configured
- Docker (for Lambda bundling)

## Installation

```bash
npm install
```

## Configuration

Set the SRI endpoint (optional, defaults to production):

```bash
export SRI_ENDPOINT="https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline"
```

## Build

Build both the CDK stack and Lambda function:

```bash
npm run build
```

## Deployment

Deploy to AWS:

```bash
npx cdk deploy
```

After deployment, note the output values:
- `QueueURL`: URL of the main SQS queue
- `DLQueueURL`: URL of the Dead Letter Queue
- `TableName`: Name of the DynamoDB table

## Usage

See [USAGE.md](./USAGE.md) for detailed examples on:
- Sending messages to the queue
- Message format requirements
- Monitoring authorization status
- Handling failed authorizations

## Testing

Run unit tests:

```bash
npm test
```

## Monitoring

### CloudWatch Logs

Lambda function logs are automatically sent to CloudWatch Logs:

```bash
aws logs tail /aws/lambda/FactureroSriAuthorizerStack-SriAuthorizerFunction --follow
```

### DynamoDB

Query authorization status:

```bash
aws dynamodb scan --table-name <TableName>
```

### Dead Letter Queue

Check for failed messages:

```bash
aws sqs receive-message --queue-url <DLQueueURL>
```

## Environment Variables

Lambda function uses:
- `TABLE_NAME`: DynamoDB table name (set automatically by CDK)
- `SRI_ENDPOINT`: SRI SOAP service URL (configurable)

## CDK Commands

* `npm run build`   - Compile TypeScript and build Lambda
* `npm run watch`   - Watch for changes and compile
* `npm run test`    - Run Jest unit tests
* `npx cdk deploy`  - Deploy stack to AWS
* `npx cdk diff`    - Compare deployed stack with current state
* `npx cdk synth`   - Emit synthesized CloudFormation template
* `npx cdk destroy` - Remove all resources from AWS

## Project Structure

```
├── bin/                          # CDK app entry point
├── lib/                          # CDK stack definition
├── lambda/
│   └── authorizer/              # Lambda function code
│       ├── index.ts             # Handler implementation
│       ├── package.json         # Lambda dependencies
│       └── tsconfig.json        # Lambda TypeScript config
├── test/                        # Unit tests
├── USAGE.md                     # Usage examples
└── README.md                    # This file
```

## Security

- DynamoDB uses encryption at rest (default AWS managed keys)
- Lambda function uses least-privilege IAM permissions
- SQS messages are encrypted in transit
- Point-in-time recovery enabled for DynamoDB

## Cost Optimization

- DynamoDB uses PAY_PER_REQUEST billing (no fixed costs)
- Lambda charged only for execution time
- SQS charges per request
- DLQ retention set to 14 days

## License

This project is licensed under the MIT License.

