FROM node:22-alpine
WORKDIR /app/api
COPY api/package.json api/package-lock.json ./
RUN apk add --no-cache su-exec \
  && npm ci --omit=dev \
  && npm cache clean --force
COPY api/server.js api/personal.js api/gym-directory.js api/brazil-locations.js api/ai.js api/ai-jobs.js api/ai-routines.js api/ai-usage.js api/ai-providers.js api/dev-auth.js ./
COPY api/domain ./domain
COPY api/lib ./lib
COPY frontend/src/lib/exercises-data.js ../frontend/src/lib/exercises-data.js
COPY frontend/src/exercise-names ../frontend/src/exercise-names
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "chown -R node:node /data && exec su-exec node node server.js"]
