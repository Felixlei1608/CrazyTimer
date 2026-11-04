FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY db ./db
COPY public ./public
ENV NODE_ENV=production
EXPOSE 3100
CMD ["node", "server/index.js"]
