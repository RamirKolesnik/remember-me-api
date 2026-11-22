FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
COPY src ./src
COPY db ./db
COPY assets ./assets
USER node
EXPOSE 8080
CMD ["node", "src/server.ts"]
