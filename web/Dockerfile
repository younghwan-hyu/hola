FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:alpine
# Self-signed TLS cert so the nginx-served app is reachable over https (required
# for camera/mic getUserMedia from a phone on the LAN). No SAN for the dynamic
# LAN IP — browsers show a one-time warning to accept. 825d = max browser-accepted.
RUN apk add --no-cache openssl \
    && mkdir -p /etc/nginx/certs \
    && openssl req -x509 -nodes -newkey rsa:2048 \
       -keyout /etc/nginx/certs/self.key \
       -out /etc/nginx/certs/self.crt \
       -days 825 \
       -subj "/CN=hola.local" \
       -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]
