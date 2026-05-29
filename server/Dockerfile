FROM node:22-alpine

WORKDIR /app

# python3 is needed by the get_weather tool (spawned as `python3 tools/...`).
RUN apk add --no-cache python3

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
COPY tools ./tools

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
