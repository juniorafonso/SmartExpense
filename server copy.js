const express = require('express');
const session = require('express-session');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const expressLayouts = require('express-ejs-layouts');


const app = express();
const PORT = 3000;

app.use(session({
  secret: 'smartexpense_secret',
  resave: false,
  saveUninitialized: true
}));

app.use(express.urlencoded({ extended: true }));  // Garante que o corpo do formulário seja processado corretamente
app.use(express.json()); // Para dados JSON, se necessário
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('layout', 'layout'); // Usará views/layout.ejs como base
app.set('views', path.join(__dirname, 'views'));

// Banco de dados
const db = new sqlite3.Database('./db.sqlite');

// Tabela de despesas
db.run(`CREATE TABLE IF NOT EXISTS despesas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT,
  valor REAL,
  data TEXT,
  tipo TEXT,
  arquivo TEXT,
  iban TEXT,
  observacoes TEXT,
  projeto TEXT
)`);

// Tabela de templates
db.run(`CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT
)`);

db.run(`CREATE TABLE IF NOT EXISTS template_despesas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER,
  nome TEXT,
  valor REAL,
  tipo TEXT,
  iban TEXT,
  observacoes TEXT,
  arquivo TEXT
)`);

// Configuração do Multer para o upload de arquivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

const upload = multer({ storage });

// Definição de usuários
const USERS = {
  junior: '1234',
  esposa: '1234'
};

// Rota para login
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { usuario, senha } = req.body;
  if (USERS[usuario] && USERS[usuario] === senha) {
    //req.session.user = usuario;
    //return res.redirect('/');
  }
  res.render('login', { error: 'Usuário ou senha inválidos' , layout: false});
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// Página inicial
app.get('/', (req, res) => {
  // if (!req.session.user) return res.redirect('/login');
  res.render('index', { user: req.session.user });
});

// ==========================
// Rota GET para a página de criação do projeto
// ==========================
app.get('/criar-projeto', (req, res) => {
  if (!req.session.user) return res.redirect('/login'); // Garante que o usuário esteja logado
  db.all('SELECT * FROM templates', (err, templates) => {
    if (err) console.error(err);
    res.render('criar-projeto', { templates }); // Passa a lista de templates para a página de criação
  });
});

// ==========================
// Rota POST para salvar o projeto
// ==========================
app.post('/criar-projeto', (req, res) => {
    const { nome, template } = req.body;  // Obtém o nome e o template selecionado do formulário
    if (!req.session.user) return res.redirect('/login');  // Garante que o usuário esteja logado

    // Verifica se o nome do projeto foi fornecido
    if (!nome) return res.redirect('/criar-projeto');  // Se o nome não for fornecido, redireciona para a página de criação novamente

    // Inserir apenas o projeto na tabela 'projetos' com status 'ativo'
    db.run('INSERT INTO projetos (nome, status) VALUES (?, ?)', 
      [nome, 'ativo'], 
      function(err) {
        if (err) {
          console.error('Erro ao criar o projeto:', err.message);
          return res.redirect('/criar-projeto');
        }

        // Se um template for selecionado, inserimos as despesas do template
        if (template && template !== "") {
          db.all('SELECT * FROM template_despesas WHERE template_id = ?', [template], (err, despesas) => {
            if (err) return console.error(err);

            // Inserir as despesas do template no projeto com status unpaid
            const stmt = db.prepare('INSERT INTO despesas (nome, valor, data, tipo, arquivo, iban, observacoes, projeto, status_pagamento) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
            despesas.forEach(d => {
              stmt.run(d.nome, d.valor, null, d.tipo, d.arquivo, d.iban, d.observacoes, nome, 'unpaid');
            });
            stmt.finalize(() => res.redirect(`/projeto/${nome}`));  // Redireciona para o projeto recém-criado
          });
        } else {
          // Se não houver template, apenas redireciona para a página do projeto
          res.redirect(`/projeto/${nome}`);
        }
      }
    );
});

// ==========================
// Rota para marcar despesa como paga
// ==========================
app.post('/projeto/:nome/despesas/:id/pagar', (req, res) => {
  const { nome, id } = req.params;

  db.run(
    'UPDATE despesas SET status_pagamento = ? WHERE id = ?',
    ['paid', id],
    (err) => {
      if (err) {
        console.error('Erro ao atualizar status da despesa:', err.message);
        return res.status(500).send('Erro ao atualizar despesa');
      }

      res.redirect(`/projeto/${nome}`);
    }
  );
});

// ==========================
// Rota para exibir o formulário de edição de um projeto
// ==========================
app.get('/projeto/:nome/editar', (req, res) => {
    const nomeProjeto = req.params.nome;  // Obtém o nome do projeto da URL
    db.get('SELECT * FROM projetos WHERE nome = ?', [nomeProjeto], (err, projeto) => {
      if (err) {
        console.error(err);
        return res.status(500).send('Erro ao buscar projeto');
      }
      if (!projeto) {
        return res.status(404).send('Projeto não encontrado');
      }
      // Passa o projeto para o template de edição
      res.render('editar-projeto', { projeto });
    });
  });
  
  // ==========================
  // Rota POST para salvar a edição de um projeto
  // ==========================
  app.post('/projeto/:nome/editar', (req, res) => {
    const { nome, status } = req.body;  // recebendo nome e status do formulario
    const { nome: oldNome } = req.params;
  
    db.run('UPDATE projetos SET nome = ?, status = ? WHERE nome = ?', [nome, status, oldNome], (err) => {
      if (err) {
        console.error(err);
        return res.status(500).send('Erro ao atualizar o projeto');
      }
      res.redirect(`/projetos`); // redireciona para a página com lista de projetos após salvar
    });
  });

// ==========================
// Rota para exibir projetos em andamento
// ==========================
app.get('/projetos', (req, res) => {
  if (!req.session.user) return res.redirect('/login');

  db.all('SELECT * FROM projetos WHERE status = ?', ['ativo'], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Erro ao buscar projetos ativos');
    }

    res.render('projetos', { projetos: rows });
  });
});

// ==========================
// Rota para exibir um projeto específico e suas despesas
// ==========================
app.get('/projeto/:nome', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const nomeProjeto = req.params.nome;
  db.all('SELECT * FROM despesas WHERE projeto = ?', [nomeProjeto], (err, despesas) => {
    if (err) console.error(err);
    res.render('projeto', { user: req.session.user, projeto: nomeProjeto, despesas });
  });
});

// ==========================
// Rota para adicionar uma despesa a um projeto
// ==========================
app.post('/projeto/:nome/despesas', upload.single('arquivo'), (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const { nome, valor, data, tipo, iban, observacoes } = req.body;
  const arquivo = req.file ? req.file.filename : null;
  const projeto = req.params.nome;
  const status_pagamento = 'unpaid'; // Sempre unpaid por padrão
  
  db.run(
    `INSERT INTO despesas (nome, valor, data, tipo, arquivo, iban, observacoes, projeto, status_pagamento) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [nome, valor, data, tipo, arquivo, iban, observacoes, projeto, status_pagamento],
    (err) => {
      if (err) console.error('Erro ao salvar despesa:', err.message);
      res.redirect(`/projeto/${projeto}`);
    }
  );
});

// ==========================
// Rota para deletar uma despesa de um projeto
// ==========================
app.post('/projeto/:nome/despesas/:id/delete', (req, res) => {
  const { nome, id } = req.params;
  db.run('DELETE FROM despesas WHERE id = ?', [id], (err) => {
    if (err) console.error(err);
    res.redirect(`/projeto/${nome}`);
  });
});

// Rota para exibir os templates
app.get('/templates', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    db.all('SELECT * FROM templates', (err, templates) => {
      if (err) {
        console.error(err);
        return res.status(500).send('Erro ao buscar templates');
      }
      
      // Contar as despesas para cada template
      const templatesComDespesas = [];
      let countCompleted = 0; // Contador para aguardar todas as consultas
  
      templates.forEach((template, index) => {
        db.get('SELECT COUNT(*) AS total FROM template_despesas WHERE template_id = ?', [template.id], (err, row) => {
          if (err) {
            console.error(err);
            return res.status(500).send('Erro ao contar despesas');
          }
  
          // Adicionar o número de despesas ao template
          template.despesasCount = row.total;
  
          templatesComDespesas.push(template);
  
          countCompleted++;
          if (countCompleted === templates.length) {
            res.render('templates', { templates: templatesComDespesas });
          }
        });
      });
    });
  });
  

// ==========================
// Rota para criar um novo template
// ==========================
app.post('/templates', (req, res) => {
  const { nome } = req.body;
  db.run('INSERT INTO templates (nome) VALUES (?)', [nome], (err) => {
    if (err) console.error(err);
    res.redirect('/templates');
  });
});

// ==========================
// Rota para exibir o formulário de criação de um novo template
// ==========================
app.get('/templates/criar', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.render('template-criar');
});

// ==========================
// Rota para editar um template específico e adicionar despesas
// ==========================
app.get('/templates/:id', (req, res) => {
  const id = req.params.id;
  db.get('SELECT * FROM templates WHERE id = ?', [id], (err, template) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Erro ao buscar o template');
    }
    if (!template) {
      return res.status(404).send('Template não encontrado');
    }
    db.all('SELECT * FROM template_despesas WHERE template_id = ?', [id], (err2, despesas) => {
      if (err2) {
        console.error(err2);
        return res.status(500).send('Erro ao buscar despesas do template');
      }
      res.render('template-editar', { template, despesas });
    });
  });
});

// ==========================
// Rota POST para adicionar despesas a um template
// ==========================
app.post('/templates/:id/despesas', upload.single('arquivo'), (req, res) => {
  const id = req.params.id;
  const { nome, valor, data, tipo, iban, observacoes } = req.body;
  const arquivo = req.file ? req.file.filename : null;
  const status_pagamento = 'unpaid'; // unpaid por padrão também aqui
  
  db.run(
    `INSERT INTO template_despesas (template_id, nome, valor, data, tipo, iban, observacoes, arquivo, status_pagamento) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, nome, valor, data, tipo, iban, observacoes, arquivo, status_pagamento],
    (err) => {
      if (err) console.error(err);
      res.redirect(`/templates/${id}`);
    }
  );
});

// ==========================
// Rota para deletar uma despesa de um template
// ==========================
app.post('/templates/:templateId/despesas/:id/delete', (req, res) => {
  const { templateId, id } = req.params;
  db.run('DELETE FROM template_despesas WHERE id = ?', [id], (err) => {
    if (err) console.error(err);
    res.redirect(`/templates/${templateId}`);
  });
});

// ==========================
// Rota para deletar um template
// ==========================
app.post('/templates/:id/delete', (req, res) => {
  const id = req.params.id;
  db.run('DELETE FROM template_despesas WHERE template_id = ?', [id], (err1) => {
    if (err1) console.error(err1);
    db.run('DELETE FROM templates WHERE id = ?', [id], (err2) => {
      if (err2) console.error(err2);
      res.redirect('/templates');
    });
  });
});

// ==========================
// Rota para deletar um projeto
// ==========================
app.post('/projetos/:nome/delete', (req, res) => {
  const nome = req.params.nome;

  // Primeiro deleta as despesas do projeto
  db.run('DELETE FROM despesas WHERE projeto = ?', [nome], (err) => {
    if (err) {
      console.error('Erro ao deletar despesas:', err);
      return res.status(500).send('Erro ao deletar despesas do projeto');
    }

    // Agora deleta o projeto da tabela projetos
    db.run('DELETE FROM projetos WHERE nome = ?', [nome], (err2) => {
      if (err2) {
        console.error('Erro ao deletar projeto:', err2);
        return res.status(500).send('Erro ao deletar projeto');
      }

      res.redirect('/projetos');  // Após deletar, redireciona para página dos projetos
    });
  });
});

// ==========================
// Rota para exibir projetos finalizados
// ==========================
app.get('/projetos/finalizados', (req, res) => {
  if (!req.session.user) return res.redirect('/login');

  db.all('SELECT * FROM projetos WHERE status = ?', ['finalizado'], (err, rows) => {
      if (err) {
          console.error(err);
          return res.status(500).send('Erro ao buscar projetos finalizados');
      }

      res.render('projetos-finalizados', { projetos: rows });
  });
});

// ==========================
// Rota GET para exibir o formulário de edição de uma despesa de um projeto
// ==========================
app.get('/projeto/:nome/despesa/:id/editar', (req, res) => {
    const { nome, id } = req.params;  // Extrai o nome do projeto e o id da despesa da URL
    db.get('SELECT * FROM despesas WHERE id = ?', [id], (err, despesa) => {
      if (err) {
        console.error(err);
        return res.status(500).send('Erro ao buscar despesa');
      }
      if (!despesa) {
        return res.status(404).send('Despesa não encontrada');
      }
      res.render('modificar-despesa', { despesa, projeto: nome });  // Passa a despesa e o nome do projeto para o formulário de edição
    });
  });
  
// ==========================
// Rota POST para atualizar uma despesa de um projeto
// ==========================
app.post('/projeto/:nome/despesa/:id/editar', upload.single('arquivo'), (req, res) => {
    const { nome, valor, data, tipo, iban, observacoes } = req.body;  // Obtém os dados do formulário
    const arquivo = req.file ? req.file.filename : null;  // Verifica se foi feito upload de um arquivo
    const { id } = req.params;  // Obtém o id da despesa a ser atualizada
  
    // Atualiza a despesa no banco de dados
    db.run(
      `UPDATE despesas SET nome = ?, valor = ?, data = ?, tipo = ?, arquivo = ?, iban = ?, observacoes = ? WHERE id = ?`,
      [nome, valor, data, tipo, arquivo, iban, observacoes, id],  // Atualiza os valores no banco
      (err) => {
        if (err) {
          console.error('Erro ao salvar a despesa:', err.message);
          return res.status(500).send('Erro ao salvar a despesa');
        }
        // Após salvar, redireciona para o projeto onde a despesa foi modificada
        res.redirect(`/projeto/${req.params.nome}`);
      }
    );
  });

// ==========================
// Rota GET para editar a despesa dentro de um template
// ==========================
app.get('/templates/:templateId/despesa/:id/editar', (req, res) => {
    const { templateId, id } = req.params;
    db.get('SELECT * FROM template_despesas WHERE id = ?', [id], (err, despesa) => {
      if (err) {
        console.error(err);
        return res.status(500).send('Erro ao buscar despesa');
      }
      if (!despesa) {
        return res.status(404).send('Despesa não encontrada');
      }
      res.render('modificar-despesa-template', { despesa, templateId });
    });
  });

// ==========================
// Rota POST para salvar a edição de uma despesa dentro de um template
// ==========================
app.post('/templates/:templateId/despesa/:id/editar', upload.single('arquivo'), (req, res) => {
    const { nome, valor, data, tipo, iban, observacoes } = req.body;
    const arquivo = req.file ? req.file.filename : null; // Caso um novo arquivo seja enviado
    const { id } = req.params;
  
    db.run(
      `UPDATE template_despesas SET nome = ?, valor = ?, data = ?, tipo = ?, arquivo = ?, iban = ?, observacoes = ? WHERE id = ?`,
      [nome, valor, data, tipo, arquivo, iban, observacoes, id],
      (err) => {
        if (err) {
          console.error('Erro ao salvar a despesa:', err.message);
          return res.status(500).send('Erro ao salvar a despesa');
        }
        res.redirect(`/templates/${req.params.templateId}`);  // Redireciona para o template após editar
      }
    );
  });
  

  
// ==========================
// Iniciar servidor
// ==========================
app.listen(PORT, () => {
  console.log(`SmartExpense rodando em http://localhost:${PORT}`);
});
