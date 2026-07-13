FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV GOLF_HEADLESS=true
ENV GOLF_RUNNER_ENABLED=true

EXPOSE 5180

CMD ["npm", "start"]
