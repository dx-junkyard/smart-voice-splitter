FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY . .

# In production, we would build. For dev, we run dev server.
# EXPOSE 5173
# CMD ["npm", "run", "dev", "--", "--host"]

CMD ["npm", "run", "dev", "--", "--host"]
