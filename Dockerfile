# Use uma imagem base do Node.js
FROM node:18

# Defina o diretório de trabalho dentro do container
WORKDIR /app

# Copie apenas os arquivos necessários para instalar as dependências
COPY package*.json ./

# Instale as dependências (incluindo as nativas)
RUN npm install --production

# Recompile os módulos nativos (como sqlite3)
RUN npm rebuild sqlite3

# Copie o restante do código para o container
COPY . .

# Certifique-se de que o diretório de uploads existe
RUN mkdir -p /app/uploads

# Exponha a porta que o servidor usa
EXPOSE 3000

# Comando para iniciar o servidor
CMD ["npm", "start"]