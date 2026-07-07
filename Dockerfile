FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV GOLF_HEADLESS=true
ENV GOLF_ENABLE_INTERNAL_SCHEDULER=false

EXPOSE 5180

CMD ["npm", "start"]
