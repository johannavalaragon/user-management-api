# STAGE 1: Build the Fastify API
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx tsc

# Run the API
FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache tini
COPY --from=build /app/dist ./dist
COPY package*.json ./
# Keeping all dependencies so Drizzle has the tools it needs
RUN npm ci
# Copying the database config and schema files
COPY src/ ./src/
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["tini", "--", "docker-entrypoint.sh"]
