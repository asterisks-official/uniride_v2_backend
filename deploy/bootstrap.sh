#!/usr/bin/env bash
# EC2 user-data — runs once on first boot as root.
# Installs Docker + Compose, adds swap (a t3.small has only 2 GB and the Nest
# build is memory-hungry), and prepares /opt/uniride for the app bundle.
set -euxo pipefail

export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get install -y ca-certificates curl gnupg rsync

# ─── Docker Engine + Compose plugin (official repo) ──────────────────────────
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable --now docker
usermod -aG docker ubuntu

# ─── 2 GB swap so `nest build` doesn't OOM on a 2 GB instance ────────────────
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ─── Unattended security updates ─────────────────────────────────────────────
apt-get install -y unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades

mkdir -p /opt/uniride
chown -R ubuntu:ubuntu /opt/uniride

touch /var/lib/uniride-bootstrap-complete
