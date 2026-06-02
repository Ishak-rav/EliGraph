#!/bin/sh
# First-time Let's Encrypt certificate setup.
# Run from the deploy/ directory on the VPS, BEFORE starting nginx with SSL.
#
# Usage: ./nginx/certbot-init.sh <domain> <email>
# Example: ./nginx/certbot-init.sh eligraph.eliadis.fr admin@eliadis.fr

set -e

DOMAIN="${1:?Usage: $0 <domain> <email>}"
EMAIL="${2:?Usage: $0 <domain> <email>}"

# Start nginx in HTTP-only mode to serve the ACME challenge
docker compose up -d nginx

# Obtain certificate via webroot challenge
docker compose run --rm certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN"

# Reload nginx to pick up the new certificate
docker compose exec nginx nginx -s reload

echo ""
echo "Certificate obtained for $DOMAIN."
echo "Update deploy/nginx/nginx.conf: replace YOUR_DOMAIN with $DOMAIN"
echo "Then run: docker compose up -d"
