FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN apk add --no-cache su-exec \
  && npm ci --omit=dev \
  && npm cache clean --force
COPY server.js ./
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "chown -R node:node /data && exec su-exec node node server.js"]
