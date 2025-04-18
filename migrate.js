const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./db.sqlite');

db.serialize(() => {
  console.log('Iniciando migração: Adicionar coluna email e índice UNIQUE à tabela users (se não existir)...');

  // 1. Verificar se a coluna 'email' já existe na tabela 'users'
  db.all("PRAGMA table_info(users)", (pragmaErr, columns) => {
    if (pragmaErr) {
      console.error("Erro ao verificar colunas da tabela users:", pragmaErr.message);
      closeDatabase(); // Fecha o DB em caso de erro
      return;
    }

    const hasEmailColumn = columns.some(col => col.name === 'email');

    if (!hasEmailColumn) {
      // 2. Se a coluna 'email' NÃO existe, adicioná-la (sem UNIQUE por enquanto)
      console.log("Coluna 'email' não encontrada. Adicionando...");
      db.run(`ALTER TABLE users ADD COLUMN email TEXT`, (addErr) => {
        if (addErr) {
          console.error('Erro ao adicionar coluna email:', addErr.message);
          closeDatabase(); // Fecha se falhar ao adicionar a coluna
        } else {
          console.log('Coluna email adicionada com sucesso.');
          // 3. Agora, criar o índice UNIQUE na coluna recém-adicionada
          console.log("Criando índice UNIQUE na coluna 'email'...");
          db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email)`, (indexErr) => {
            if (indexErr) {
              // Este erro pode ocorrer se houver emails NULL ou duplicados (improvável em coluna nova)
               console.error('Erro ao criar índice UNIQUE na coluna email:', indexErr.message);
               if (indexErr.message.toLowerCase().includes('constraint failed') || indexErr.message.toLowerCase().includes('unique constraint failed')) {
                   console.warn('Aviso: A criação do índice UNIQUE falhou. Verifique se existem valores duplicados ou NULLs inesperados na coluna email (pouco provável em coluna nova).');
               }
            } else {
              console.log('Índice UNIQUE idx_users_email criado com sucesso (ou já existia).');
            }
            // Fecha o banco após tentar criar o índice
            closeDatabase();
          });
        }
      });
    } else {
      // 4. Se a coluna 'email' JÁ existe, verificar/criar o índice UNIQUE
      console.log("Coluna 'email' já existe na tabela users.");
      console.log("Verificando/Criando índice UNIQUE na coluna 'email'...");
      // Tenta criar o índice UNIQUE (IF NOT EXISTS garante que não dará erro se já existir)
      db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email)`, (indexErr) => {
        if (indexErr) {
           console.error('Erro ao criar índice UNIQUE na coluna email existente:', indexErr.message);
           if (indexErr.message.toLowerCase().includes('constraint failed') || indexErr.message.toLowerCase().includes('unique constraint failed')) {
               console.warn('Aviso: A criação do índice UNIQUE falhou. Verifique se existem valores duplicados na coluna email existente.');
           }
        } else {
          console.log('Índice UNIQUE idx_users_email verificado/criado com sucesso.');
        }
        // Fecha o banco após tentar criar o índice
        closeDatabase();
      });
    }
  });

  // Função para fechar o banco de dados
  function closeDatabase() {
    db.close((closeErr) => {
      if (closeErr) {
        console.error('Erro ao fechar o banco de dados:', closeErr.message);
      } else {
        console.log('Migração da coluna/índice email concluída. Conexão encerrada.');
      }
    });
  }

}); // Fim do db.serialize