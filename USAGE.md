# SRI Authorizer - Example Message Format

## SQS Message Format

To send a voucher for authorization, publish a message to the SQS queue with the following format:

```json
{
  "accessKey": "2801202401179914836900110010010000000011234567813"
}
```

## Message Fields

- `accessKey` (required): The SRI access key for the voucher to authorize (49 digits)
- `xml` (optional): The XML content of the voucher (if needed for additional processing)

## Example: Sending a Message via AWS CLI

```bash
aws sqs send-message \
  --queue-url <YOUR_QUEUE_URL> \
  --message-body '{"accessKey":"2801202401179914836900110010010000000011234567813"}'
```

## DynamoDB Record Structure

After processing, the DynamoDB table will contain:

```json
{
  "accessKey": "2801202401179914836900110010010000000011234567813",
  "status": "AUTHORIZED",
  "updatedAt": "2026-02-21T10:30:00.000Z",
  "details": {
    "estado": "AUTORIZADO",
    "numeroAutorizacion": "2801202401179914836900110010010000000011234567813",
    "fechaAutorizacion": "21/02/2026 10:30:00",
    "mensajes": []
  }
}
```

## Status Values

- `PROCESSING`: Voucher is being processed by the Lambda function
- `AUTHORIZED`: Voucher was successfully authorized by SRI
- `NOT_AUTHORIZED`: Voucher was rejected by SRI

## Retry Logic

The system will retry failed messages up to 3 times. After 3 failed attempts, the message will be moved to the Dead Letter Queue (DLQ).

## Testing

You can test the authorization by sending a test message:

```bash
# Get the queue URL from CDK outputs
aws sqs send-message \
  --queue-url $(aws cloudformation describe-stacks \
    --stack-name FactureroSriAuthorizerStack \
    --query 'Stacks[0].Outputs[?OutputKey==`QueueURL`].OutputValue' \
    --output text) \
  --message-body '{"accessKey":"2801202401179914836900110010010000000011234567813"}'
```

## Monitoring

Check the DynamoDB table for the status:

```bash
aws dynamodb get-item \
  --table-name $(aws cloudformation describe-stacks \
    --stack-name FactureroSriAuthorizerStack \
    --query 'Stacks[0].Outputs[?OutputKey==`TableName`].OutputValue' \
    --output text) \
  --key '{"accessKey":{"S":"2801202401179914836900110010010000000011234567813"}}'
```

Check for failed messages in the DLQ:

```bash
aws sqs receive-message \
  --queue-url $(aws cloudformation describe-stacks \
    --stack-name FactureroSriAuthorizerStack \
    --query 'Stacks[0].Outputs[?OutputKey==`DLQueueURL`].OutputValue' \
    --output text)
```
