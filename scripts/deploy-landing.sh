#!/usr/bin/env bash
set -euo pipefail

BUCKET="goat-flow.com"
REGION="us-east-1"
DOMAIN="goat-flow.com"
SITE_DIR="docs/site"

echo "=== goat-flow.com Landing Page Deployment ==="
echo "Bucket: $BUCKET | Region: $REGION | Domain: $DOMAIN"
echo ""

# -------------------------------------------------------------------
# Step 1: Create S3 bucket
# -------------------------------------------------------------------
echo "[1/9] Creating S3 bucket..."
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "  Bucket already exists, skipping."
else
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"
  echo "  Created bucket: $BUCKET"
fi

# -------------------------------------------------------------------
# Step 2: Block all public access (CloudFront OAC handles access)
# -------------------------------------------------------------------
echo "[2/9] Blocking public access on bucket..."
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
echo "  Public access blocked."

# -------------------------------------------------------------------
# Step 3: Request ACM certificate (must be us-east-1 for CloudFront)
# -------------------------------------------------------------------
echo "[3/9] Requesting ACM certificate..."
EXISTING_CERT=$(aws acm list-certificates --region us-east-1 \
  --query "CertificateSummaryList[?DomainName=='${DOMAIN}' && Status!='FAILED'].CertificateArn" \
  --output text 2>/dev/null || true)

if [[ -n "$EXISTING_CERT" && "$EXISTING_CERT" != "None" ]]; then
  CERT_ARN="$EXISTING_CERT"
  echo "  Using existing certificate: $CERT_ARN"
else
  CERT_ARN=$(aws acm request-certificate --region us-east-1 \
    --domain-name "$DOMAIN" \
    --subject-alternative-names "www.${DOMAIN}" \
    --validation-method DNS \
    --query 'CertificateArn' --output text)
  echo "  Requested certificate: $CERT_ARN"
fi

# -------------------------------------------------------------------
# Step 4: Get Route53 hosted zone ID
# -------------------------------------------------------------------
echo "[4/9] Looking up Route53 hosted zone..."
HOSTED_ZONE_ID=$(aws route53 list-hosted-zones \
  --query "HostedZones[?Name=='${DOMAIN}.'].Id" --output text \
  | sed 's|/hostedzone/||')

if [[ -z "$HOSTED_ZONE_ID" ]]; then
  echo "  ERROR: No hosted zone found for $DOMAIN"
  exit 1
fi
echo "  Hosted zone: $HOSTED_ZONE_ID"

# -------------------------------------------------------------------
# Step 5: Add DNS validation records for ACM
# -------------------------------------------------------------------
echo "[5/9] Adding DNS validation records..."
sleep 5  # give ACM a moment to generate validation records

VALIDATION_JSON=$(aws acm describe-certificate --region us-east-1 \
  --certificate-arn "$CERT_ARN" \
  --query 'Certificate.DomainValidationOptions')

VALIDATION_COUNT=$(echo "$VALIDATION_JSON" | python3 -c "
import json, sys
opts = json.load(sys.stdin)
seen = set()
for opt in opts:
    r = opt.get('ResourceRecord', {})
    name = r.get('Name', '')
    if name and name not in seen:
        seen.add(name)
        print(json.dumps(r))
" | wc -l)

echo "$VALIDATION_JSON" | python3 -c "
import json, sys
opts = json.load(sys.stdin)
seen = set()
changes = []
for opt in opts:
    r = opt.get('ResourceRecord', {})
    name = r.get('Name', '')
    if name and name not in seen:
        seen.add(name)
        changes.append({
            'Action': 'UPSERT',
            'ResourceRecordSet': {
                'Name': r['Name'],
                'Type': r['Type'],
                'TTL': 300,
                'ResourceRecords': [{'Value': r['Value']}]
            }
        })
batch = {'Changes': changes}
print(json.dumps(batch))
" > /tmp/acm-validation-records.json

aws route53 change-resource-record-sets \
  --hosted-zone-id "$HOSTED_ZONE_ID" \
  --change-batch file:///tmp/acm-validation-records.json > /dev/null
echo "  Added $VALIDATION_COUNT validation record(s)."

# -------------------------------------------------------------------
# Step 6: Wait for certificate validation
# -------------------------------------------------------------------
echo "[6/9] Waiting for certificate validation (this can take 2-5 minutes)..."
aws acm wait certificate-validated --region us-east-1 \
  --certificate-arn "$CERT_ARN" 2>/dev/null || true

CERT_STATUS=$(aws acm describe-certificate --region us-east-1 \
  --certificate-arn "$CERT_ARN" \
  --query 'Certificate.Status' --output text)

if [[ "$CERT_STATUS" != "ISSUED" ]]; then
  echo "  Certificate status: $CERT_STATUS (may still be validating)"
  echo "  Re-run this script once it shows ISSUED."
  echo "  Check: aws acm describe-certificate --region us-east-1 --certificate-arn $CERT_ARN --query Certificate.Status"
  exit 1
fi
echo "  Certificate validated and issued."

# -------------------------------------------------------------------
# Step 7: Create CloudFront Origin Access Control
# -------------------------------------------------------------------
echo "[7/9] Creating CloudFront distribution..."
OAC_ID=$(aws cloudfront list-origin-access-controls \
  --query "OriginAccessControlList.Items[?Name=='${BUCKET}-oac'].Id" \
  --output text 2>/dev/null || true)

if [[ -z "$OAC_ID" || "$OAC_ID" == "None" ]]; then
  OAC_ID=$(aws cloudfront create-origin-access-control \
    --origin-access-control-config "{
      \"Name\": \"${BUCKET}-oac\",
      \"SigningProtocol\": \"sigv4\",
      \"SigningBehavior\": \"always\",
      \"OriginAccessControlOriginType\": \"s3\",
      \"Description\": \"OAC for ${BUCKET}\"
    }" --query 'OriginAccessControl.Id' --output text)
  echo "  Created OAC: $OAC_ID"
else
  echo "  Using existing OAC: $OAC_ID"
fi

# -------------------------------------------------------------------
# Step 8: Create CloudFront distribution
# -------------------------------------------------------------------
EXISTING_DIST=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?contains(Aliases.Items, '${DOMAIN}')].Id" \
  --output text 2>/dev/null || true)

if [[ -n "$EXISTING_DIST" && "$EXISTING_DIST" != "None" ]]; then
  DIST_ID="$EXISTING_DIST"
  DIST_DOMAIN=$(aws cloudfront get-distribution --id "$DIST_ID" \
    --query 'Distribution.DomainName' --output text)
  echo "  Using existing distribution: $DIST_ID ($DIST_DOMAIN)"
else
  CALLER_REF="goat-flow-$(date +%s)"
  DIST_CONFIG=$(cat <<DISTJSON
{
  "CallerReference": "${CALLER_REF}",
  "Aliases": {
    "Quantity": 2,
    "Items": ["${DOMAIN}", "www.${DOMAIN}"]
  },
  "DefaultRootObject": "index.html",
  "Origins": {
    "Quantity": 1,
    "Items": [
      {
        "Id": "S3-${BUCKET}",
        "DomainName": "${BUCKET}.s3.${REGION}.amazonaws.com",
        "OriginAccessControlId": "${OAC_ID}",
        "S3OriginConfig": {
          "OriginAccessIdentity": ""
        }
      }
    ]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "S3-${BUCKET}",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": {
      "Quantity": 2,
      "Items": ["GET", "HEAD"]
    },
    "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
    "Compress": true
  },
  "ViewerCertificate": {
    "ACMCertificateArn": "${CERT_ARN}",
    "SSLSupportMethod": "sni-only",
    "MinimumProtocolVersion": "TLSv1.2_2021"
  },
  "Enabled": true,
  "HttpVersion": "http2and3",
  "Comment": "goat-flow landing page",
  "PriceClass": "PriceClass_100",
  "CustomErrorResponses": {
    "Quantity": 1,
    "Items": [
      {
        "ErrorCode": 403,
        "ResponsePagePath": "/index.html",
        "ResponseCode": "200",
        "ErrorCachingMinTTL": 300
      }
    ]
  }
}
DISTJSON
)

  DIST_RESULT=$(aws cloudfront create-distribution \
    --distribution-config "$DIST_CONFIG" \
    --query 'Distribution.[Id,DomainName]' --output text)
  DIST_ID=$(echo "$DIST_RESULT" | awk '{print $1}')
  DIST_DOMAIN=$(echo "$DIST_RESULT" | awk '{print $2}')
  echo "  Created distribution: $DIST_ID ($DIST_DOMAIN)"
fi

# -------------------------------------------------------------------
# Step 8b: Add bucket policy allowing CloudFront OAC
# -------------------------------------------------------------------
echo "  Setting bucket policy for CloudFront access..."
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query 'Account' --output text)

BUCKET_POLICY=$(cat <<POLICYJSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontServicePrincipal",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::${BUCKET}/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::${AWS_ACCOUNT_ID}:distribution/${DIST_ID}"
        }
      }
    }
  ]
}
POLICYJSON
)

aws s3api put-bucket-policy --bucket "$BUCKET" --policy "$BUCKET_POLICY"
echo "  Bucket policy applied."

# -------------------------------------------------------------------
# Step 9: Upload content
# -------------------------------------------------------------------
echo "[8/9] Uploading site content..."
aws s3 cp "${SITE_DIR}/goat-flow-landing.html" "s3://${BUCKET}/index.html" \
  --content-type "text/html; charset=utf-8" \
  --cache-control "max-age=3600"
echo "  Uploaded index.html"

aws s3 cp "${SITE_DIR}/goat-flow-harness-engineering.html" "s3://${BUCKET}/what-is-harness-engineering" \
  --content-type "text/html; charset=utf-8" \
  --cache-control "max-age=3600"
echo "  Uploaded what-is-harness-engineering"

aws s3 cp "${SITE_DIR}/goat-flow-og.jpg" "s3://${BUCKET}/goat-flow-og.jpg" \
  --content-type "image/jpeg" \
  --cache-control "max-age=86400"
echo "  Uploaded goat-flow-og.jpg"

aws s3 cp "${SITE_DIR}/harness-engineering-og.jpg" "s3://${BUCKET}/harness-engineering-og.jpg" \
  --content-type "image/jpeg" \
  --cache-control "max-age=86400"
echo "  Uploaded harness-engineering-og.jpg"

# -------------------------------------------------------------------
# Step 9b: Invalidate CloudFront cache (so re-runs pick up changes)
# -------------------------------------------------------------------
echo "  Invalidating CloudFront cache..."
aws cloudfront create-invalidation --distribution-id "$DIST_ID" \
  --paths "/*" --query 'Invalidation.Id' --output text > /dev/null
echo "  Cache invalidation submitted."

# -------------------------------------------------------------------
# Step 10: Create Route53 alias records
# -------------------------------------------------------------------
echo "[9/9] Creating Route53 DNS records..."
CLOUDFRONT_HOSTED_ZONE="Z2FDTNDATAQYW2"  # constant for all CloudFront distributions

ROUTE53_CHANGES=$(cat <<R53JSON
{
  "Changes": [
    {
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "${DOMAIN}",
        "Type": "A",
        "AliasTarget": {
          "HostedZoneId": "${CLOUDFRONT_HOSTED_ZONE}",
          "DNSName": "${DIST_DOMAIN}",
          "EvaluateTargetHealth": false
        }
      }
    },
    {
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "www.${DOMAIN}",
        "Type": "A",
        "AliasTarget": {
          "HostedZoneId": "${CLOUDFRONT_HOSTED_ZONE}",
          "DNSName": "${DIST_DOMAIN}",
          "EvaluateTargetHealth": false
        }
      }
    }
  ]
}
R53JSON
)

aws route53 change-resource-record-sets \
  --hosted-zone-id "$HOSTED_ZONE_ID" \
  --change-batch "$ROUTE53_CHANGES" > /dev/null
echo "  DNS records created for $DOMAIN and www.$DOMAIN"

# -------------------------------------------------------------------
# Done
# -------------------------------------------------------------------
echo ""
echo "=== Deployment Complete ==="
echo "Distribution ID: $DIST_ID"
echo "CloudFront URL:  https://$DIST_DOMAIN"
echo "Live URL:        https://$DOMAIN"
echo ""
echo "CloudFront takes 5-15 minutes to fully deploy."
echo "Check status: aws cloudfront get-distribution --id $DIST_ID --query Distribution.Status"
echo ""
echo "To redeploy, just re-run: bash scripts/deploy-landing.sh"
