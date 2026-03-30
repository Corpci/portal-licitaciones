FROM node:20-alpine

WORKDIR /app

# Install Python + MySQL client libs
RUN apk add --no-cache python3 py3-pip

COPY package*.json ./
RUN npm install

COPY scraper/requirements.txt scraper/requirements.txt
RUN pip3 install --break-system-packages -r scraper/requirements.txt

COPY . .

RUN npm run build

EXPOSE 3001

CMD ["node_modules/.bin/tsx", "server.ts"]
