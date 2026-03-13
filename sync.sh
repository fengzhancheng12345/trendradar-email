#!/bin/bash
# Sync TrendRadar Pro from GitHub

cd /root

# Remove old files
rm -f api_service.py trendy-v4.cjs

# Download from GitHub raw
curl -sL https://raw.githubusercontent.com/fengzhancheng12345/trendradar-email/main/api_service.py -o api_service.py
curl -sL https://raw.githubusercontent.com/fengzhancheng12345/trendradar-email/main/trendy-v4.cjs -o trendy-v4.cjs

echo "Files synced!"

# Restart services
pm2 restart all
echo "Services restarted!"
