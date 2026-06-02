#!/bin/sh
# First-time Let's Encrypt certificate setup.
# Run from the deploy/ directory on the VPS.
#
# Usage: ./nginx/certbot-init.sh <domain> <email>
# Example: ./nginx/certbot-init.sh eligraph.eliadis.fr admin@eliadis.fr
#
# This script uses certbot standalone mode (certbot binds port 80 directly),
# so nginx must NOT be running when this script executes.

set -e

DOMAIN="${1:?Usage: $0 <domain> <email>}"
EMAIL="${2:?Usage: $0 <domain> <email>}"

# 1. Replace YOUR_DOMAIN placeholder in nginx config
sed -i "s/YOUR_DOMAIN/$DOMAIN/g" ./nginx/nginx.conf
echo "Updated nginx.conf: YOUR_DOMAIN → $DOMAIN"

# 2. Stop any running containers so port 80 is free for certbot standalone
docker compose down 2>/dev/null || true

# 3. Obtain certificate (certbot listens directly on :80, no nginx needed)
docker compose --profile certbot run --rm -p 80:80 certbot certonly \
  --standalone \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN"

# 4. Start the full stack (nginx now has valid certs)
docker compose up -d

echo ""
echo "Certificate obtained for $DOMAIN. Stack is running."
echo ""
echo "IMPORTANT — add the following cron on this VPS to renew certificates"
echo "and reload nginx automatically (run: crontab -e):"
echo ""
echo "  0 3 */2 * * cd /opt/eligraph && docker compose --profile certbot run --rm certbot certbot renew --quiet && docker compose exec nginx nginx -s reload"
echo ""
