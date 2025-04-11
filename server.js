let DEFAULT_LOCALE;

// server.js
const express = require('express');
const session = require('express-session');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const expressLayouts = require('express-ejs-layouts');
const fs = require('fs');
const lang = require('./lang.json');
const config = require('./config');
DEFAULT_LOCALE = ['pt', 'en', 'fr'].includes(config.DEFAULT_LOCALE)
  ? config.DEFAULT_LOCALE
  : 'en';


const DEV_MODE = config.DEV_MODE;


function requireLogin(req, res, next) {
  if (!DEV_MODE && !req.session.user) {
    return res.redirect('/login');
  }
  next();
}

const app = express();
const PORT = 3000;
app.use((req, res, next) => {
  const langCode = (req.session && req.session.lang) || config.DEFAULT_LOCALE || 'en';

  // Fallback se o idioma for inválido
  const idiomaValido = ['pt', 'en', 'fr'].includes(langCode) ? langCode : 'en';

  // Salva na sessão, caso ainda não tenha
  if (req.session) {
    req.session.lang = idiomaValido;
  }

  // Passa o idioma e config para as views
  res.locals.lang = lang[idiomaValido];
  res.locals.config = config;

  next();
});


app.use(session({
  secret: 'smartexpense_secret',
  resave: false,
  saveUninitialized: true
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('layout', 'layout');
app.set('views', path.join(__dirname, 'views'));

const db = new sqlite3.Database('./db.sqlite');



app.get('/configuracoes', requireLogin, (req, res) => {
  res.render('configuracoes', { config });
});

app.post('/configuracoes', requireLogin, (req, res) => {
  const { DEV_MODE, DEFAULT_LOCALE: novoLocale, DEFAULT_CURRENCY } = req.body;

  req.session.lang = novoLocale || 'en';

  const novoConfig = {
    DEV_MODE: DEV_MODE === 'true',
    DEFAULT_LOCALE: novoLocale,
    DEFAULT_CURRENCY,
    USERS: config.USERS
  };

  const conteudo = `module.exports = ${JSON.stringify(novoConfig, null, 2)};\n`;
  fs.writeFileSync('./config.js', conteudo, 'utf8');

  // Recarrega o novo config
  delete require.cache[require.resolve('./config')];
  const novoConfigRecarregado = require('./config');

  // Atualiza DEFAULT_LOCALE global
  DEFAULT_LOCALE = ['pt', 'en', 'fr'].includes(novoConfigRecarregado.DEFAULT_LOCALE)
    ? novoConfigRecarregado.DEFAULT_LOCALE
    : 'en';

  // Atualiza o objeto config
  Object.keys(config).forEach(k => delete config[k]);
  Object.assign(config, novoConfigRecarregado);

  // Só força login se DEV_MODE foi DESATIVADO
  if (!novoConfigRecarregado.DEV_MODE) {
    req.session.destroy(() => res.redirect('/login'));
  } else {
    res.redirect('/configuracoes');
  }
});


// Multer para upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

const USERS = config.USERS

// Login
app.get('/login', (req, res) => {
  res.render('login', { error: null, lang: res.locals.lang, layout: 'login_layout' });

});

app.post('/login', (req, res) => {
  const { usuario, senha, language } = req.body;
  // Lógica de autenticação
  if (config.USERS[usuario] === senha) {
    req.session.user = usuario;
    req.session.lang = language; // Define o idioma na sessão
    res.redirect('/');
  } else {
    res.render('login', { error: true, lang: res.locals.lang, layout: 'login_layout' });
  }
});

// Página inicial
app.get('/', requireLogin, (req, res) => {
  res.render('index', { user: req.session.user });
});

// Criação e edição de projetos
app.get('/criar-projeto', requireLogin, (req, res) => {
  db.all('SELECT * FROM templates', (err, templates) => {
    if (err) console.error(err);
    res.render('criar-projeto', { templates, lang: res.locals.lang });
  });
});

app.post('/criar-projeto', requireLogin, (req, res) => {
  const { nome, template } = req.body;
  if (!nome) return res.redirect('/criar-projeto');

  db.run('INSERT INTO projetos (nome, status) VALUES (?, ?)', [nome, 'ativo'], function (err) {
    if (err) {
      console.error('Erro ao criar o projeto:', err.message);
      return res.redirect('/criar-projeto');
    }

    if (template && template !== '') {
      db.all('SELECT * FROM template_despesas WHERE template_id = ?', [template], (err, despesas) => {
        if (err) return console.error(err);

        const now = new Date(); // data atual como fallback
        const anoAtual = now.getFullYear();
        const mesAtual = now.getMonth() + 1; // 1 a 12

        const stmt = db.prepare('INSERT INTO despesas (nome, valor, data, tipo, arquivo, iban, observacoes, projeto, status_pagamento) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');

        despesas.forEach(d => {
          const dia = d.dia_do_mes || 1; // fallback para dia 1 se não vier preenchido
          const dataReal = `${anoAtual}-${String(mesAtual).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

          stmt.run(d.nome, d.valor, dataReal, d.tipo, d.arquivo, d.iban, d.observacoes, nome, 'unpaid');
        });
        stmt.finalize(() => res.redirect(`/projeto/${nome}`));
      });
    } else {
      res.redirect(`/projeto/${nome}`);
    }
  });
});

// Projetos
app.get('/projetos', requireLogin, (req, res) => {
  db.all('SELECT * FROM projetos WHERE status = ?', ['ativo'], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Erro ao buscar projetos ativos');
    }
    res.render('projetos', { projetos: rows });
  });
});

app.get('/projetos/finalizados', requireLogin, (req, res) => {
  db.all('SELECT * FROM projetos WHERE status = ?', ['finalizado'], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Erro ao buscar projetos finalizados');
    }
    res.render('projetos-finalizados', { projetos: rows });
  });
});

app.post('/projetos/:nome/delete', requireLogin, (req, res) => {
  const nome = req.params.nome;
  db.run('DELETE FROM despesas WHERE projeto = ?', [nome], (err) => {
    if (err) return res.status(500).send('Erro ao deletar despesas');
    db.run('DELETE FROM projetos WHERE nome = ?', [nome], (err2) => {
      if (err2) return res.status(500).send('Erro ao deletar projeto');
      res.redirect('/projetos');
    });
  });
});

// Edição de projeto
app.get('/projeto/:nome/editar', requireLogin, (req, res) => {
  const nomeProjeto = req.params.nome;
  db.get('SELECT * FROM projetos WHERE nome = ?', [nomeProjeto], (err, projeto) => {
    if (err) return res.status(500).send('Erro ao buscar projeto');
    if (!projeto) return res.status(404).send('Projeto não encontrado');
    res.render('editar-projeto', { projeto });
  });
});

app.post('/projeto/:nome/editar', requireLogin, (req, res) => {
  const { nome, status } = req.body;
  const { nome: oldNome } = req.params;
  db.run('UPDATE projetos SET nome = ?, status = ? WHERE nome = ?', [nome, status, oldNome], (err) => {
    if (err) return res.status(500).send('Erro ao atualizar projeto');
    res.redirect('/projetos');
  });
});

// Despesas
app.get('/projeto/:nome', requireLogin, (req, res) => {
  const nomeProjeto = req.params.nome;
  db.all('SELECT * FROM despesas WHERE projeto = ?', [nomeProjeto], (err, despesas) => {
    if (err) console.error(err);
    res.render('projeto', { user: req.session.user, projeto: nomeProjeto, despesas });
  });
});

app.post('/projeto/:nome/despesas', requireLogin, upload.single('arquivo'), (req, res) => {
  const { nome, valor, data, tipo, iban, observacoes } = req.body;
  const arquivo = req.file ? req.file.filename : null;
  const projeto = req.params.nome;
  db.run(
    `INSERT INTO despesas (nome, valor, data, tipo, arquivo, iban, observacoes, projeto, status_pagamento) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [nome, valor, data, tipo, arquivo, iban, observacoes, projeto, 'unpaid'],
    (err) => {
      if (err) console.error(err);
      res.redirect(`/projeto/${projeto}`);
    }
  );
});

app.post('/projeto/:nome/despesas/:id/pagar', requireLogin, (req, res) => {
  const { nome, id } = req.params;
  db.run('UPDATE despesas SET status_pagamento = ? WHERE id = ?', ['paid', id], (err) => {
    if (err) return res.status(500).send('Erro ao atualizar despesa');
    res.redirect(`/projeto/${nome}`);
  });
});

app.post('/projeto/:nome/despesas/:id/delete', requireLogin, (req, res) => {
  const { nome, id } = req.params;
  db.run('DELETE FROM despesas WHERE id = ?', [id], (err) => {
    if (err) console.error(err);
    res.redirect(`/projeto/${nome}`);
  });
});

// Templates
app.get('/templates', requireLogin, (req, res) => {
  db.all('SELECT * FROM templates', (err, templates) => {
    if (err) return res.status(500).send('Erro ao buscar templates');

    if (templates.length === 0) {
      return res.render('templates', { templates: [] }); // <- aqui resolve
    }

    const templatesComDespesas = [];
    let countCompleted = 0;

    templates.forEach((template) => {
      db.get('SELECT COUNT(*) AS total FROM template_despesas WHERE template_id = ?', [template.id], (err, row) => {
        if (err) return res.status(500).send('Erro ao contar despesas');
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


app.get('/templates/criar', requireLogin, (req, res) => {
  res.render('template-criar');
});

app.post('/templates', requireLogin, (req, res) => {
  const { nome } = req.body;
  db.run('INSERT INTO templates (nome) VALUES (?)', [nome], (err) => {
    if (err) console.error(err);
    res.redirect('/templates');
  });
});

app.get('/templates/:id', requireLogin, (req, res) => {
  const id = req.params.id;
  db.get('SELECT * FROM templates WHERE id = ?', [id], (err, template) => {
    if (err || !template) return res.status(500).send('Erro ao buscar o template');
    db.all('SELECT * FROM template_despesas WHERE template_id = ?', [id], (err2, despesas) => {
      if (err2) return res.status(500).send('Erro ao buscar despesas');
      res.render('template-editar', { template, despesas });
    });
  });
});

app.post('/templates/:id/despesas', requireLogin, upload.single('arquivo'), (req, res) => {
  const id = req.params.id;
  const { nome, valor, dia_do_mes, tipo, iban, observacoes } = req.body;
  const arquivo = req.file ? req.file.filename : null;
  db.run(
    `INSERT INTO template_despesas (template_id, nome, valor, tipo, iban, observacoes, arquivo, status_pagamento, dia_do_mes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, nome, valor, tipo, iban, observacoes, arquivo, 'unpaid', dia_do_mes],
    (err) => {
      if (err) console.error(err);
      res.redirect(`/templates/${id}`);
    }
  );
});

app.post('/templates/:templateId/despesas/:id/delete', requireLogin, (req, res) => {
  const { templateId, id } = req.params;
  db.run('DELETE FROM template_despesas WHERE id = ?', [id], (err) => {
    if (err) console.error(err);
    res.redirect(`/templates/${templateId}`);
  });
});

app.post('/templates/:id/delete', requireLogin, (req, res) => {
  const id = req.params.id;
  db.run('DELETE FROM template_despesas WHERE template_id = ?', [id], (err1) => {
    if (err1) console.error(err1);
    db.run('DELETE FROM templates WHERE id = ?', [id], (err2) => {
      if (err2) console.error(err2);
      res.redirect('/templates');
    });
  });
});

// Modificação de despesas
app.get('/projeto/:nome/despesa/:id/editar', requireLogin, (req, res) => {
  const { nome, id } = req.params;
  db.get('SELECT * FROM despesas WHERE id = ?', [id], (err, despesa) => {
    if (err || !despesa) return res.status(500).send('Erro ao buscar despesa');
    res.render('modificar-despesa', { despesa, projeto: nome });
  });
});

app.post('/projeto/:nome/despesa/:id/editar', requireLogin, upload.single('arquivo'), (req, res) => {
  const { nome, valor, data, tipo, iban, observacoes, deletar_arquivo } = req.body;
  const { id } = req.params;
  const novoArquivo = req.file ? req.file.filename : null;

  // Primeiro, buscamos o arquivo antigo (se existir)
  db.get('SELECT arquivo FROM despesas WHERE id = ?', [id], (err, row) => {
    if (err || !row) return res.status(500).send('Erro ao buscar despesa');

    const arquivoAntigo = row.arquivo;
    let arquivoFinal = arquivoAntigo;

    if (deletar_arquivo === 'true') {
      // Se o usuário pediu para deletar o arquivo antigo
      if (arquivoAntigo) {
        const caminho = path.join(__dirname, 'uploads', arquivoAntigo);
        fs.unlink(caminho, (err) => {
          if (err) console.error('Erro ao deletar arquivo antigo:', err.message);
        });
      }
      arquivoFinal = null;
    }

    if (novoArquivo) {
      // Novo upload substitui o antigo
      arquivoFinal = novoArquivo;
    }

    db.run(
      `UPDATE despesas SET nome = ?, valor = ?, data = ?, tipo = ?, arquivo = ?, iban = ?, observacoes = ? WHERE id = ?`,
      [nome, valor, data, tipo, arquivoFinal, iban, observacoes, id],
      (err) => {
        if (err) return res.status(500).send('Erro ao salvar a despesa');
        res.redirect(`/projeto/${req.params.nome}`);
      }
    );
  });
});


app.get('/templates/:templateId/despesa/:id/editar', requireLogin, (req, res) => {
  const { templateId, id } = req.params;
  db.get('SELECT * FROM template_despesas WHERE id = ?', [id], (err, despesa) => {
    if (err || !despesa) return res.status(500).send('Erro ao buscar despesa');
    res.render('modificar-despesa-template', { despesa, templateId });
  });
});

app.post('/templates/:templateId/despesa/:id/editar', requireLogin, upload.single('arquivo'), (req, res) => {
  const { nome, valor, dia_do_mes, tipo, iban, observacoes, deletar_arquivo } = req.body;
  const { templateId, id } = req.params;
  const novoArquivo = req.file ? req.file.filename : null;

  db.get('SELECT arquivo FROM template_despesas WHERE id = ?', [id], (err, row) => {
    if (err || !row) return res.status(500).send('Erro ao buscar despesa');

    const arquivoAntigo = row.arquivo;
    let arquivoFinal = arquivoAntigo;

    if (deletar_arquivo === 'true') {
      if (arquivoAntigo) {
        const caminho = path.join(__dirname, 'uploads', arquivoAntigo);
        fs.unlink(caminho, (err) => {
          if (err) console.error('Erro ao deletar arquivo antigo:', err.message);
        });
      }
      arquivoFinal = null;
    }

    if (novoArquivo) {
      arquivoFinal = novoArquivo;
    }

    db.run(
      `UPDATE template_despesas SET nome = ?, valor = ?, dia_do_mes = ?, tipo = ?, arquivo = ?, iban = ?, observacoes = ? WHERE id = ?`,
      [nome, valor, dia_do_mes, tipo, arquivoFinal, iban, observacoes, id],
      (err) => {
        if (err) return res.status(500).send('Erro ao salvar a despesa');
        res.redirect(`/templates/${templateId}`);
      }
    );
  });
});


app.post('/templates/:id/editar', requireLogin, (req, res) => {
  const { nome } = req.body; // Obtém o novo nome do template
  const { id } = req.params; // Obtém o ID do template

  db.run(
    `UPDATE templates SET nome = ? WHERE id = ?`,
    [nome, id], // Atualiza o nome no banco de dados
    (err) => {
      if (err) {
        console.error('Erro ao editar o template:', err.message);
        return res.status(500).send('Erro ao editar o template');
      }
      res.redirect(`/templates/${id}`); // Redireciona de volta para o template atualizado
    }
  );
});

app.post('/projeto/:nome/despesas/:id/unpaid', requireLogin, (req, res) => {
  const { nome, id } = req.params;
  db.run('UPDATE despesas SET status_pagamento = ? WHERE id = ?', ['unpaid', id], (err) => {
    if (err) return res.status(500).send('Erro ao marcar como não pago');
    res.redirect(`/projeto/${nome}`);
  });
});

app.get('/payments', requireLogin, (req, res) => {
  db.all('SELECT * FROM Payments', (err, payments) => {
    if (err) {
      console.error('Erro ao buscar métodos de pagamento:', err);
      return res.status(500).send('Erro ao buscar métodos de pagamento.');
    }
    res.render('payments-methods', {
      payments: payments,
      countries: [], // deixamos vazio por enquanto
      currencies: [], // idem
      lang: req.session.language || 'en'
    });
  });
});

app.get('/payments/form-data', requireLogin, async (req, res) => {
  try {
    // Buscar países
    const countriesRes = await fetch('https://restcountries.com/v3.1/all');
    const countriesData = await countriesRes.json();
    const countries = countriesData.map(country => ({
      code: country.cca2,
      name: country.name.common
    })).sort((a, b) => a.name.localeCompare(b.name));

    // Buscar moedas
    const currenciesRes = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    const currenciesData = await currenciesRes.json();
    const currencies = Object.keys(currenciesData.rates).map(code => ({
      code: code,
      name: code
    })).sort((a, b) => a.code.localeCompare(b.code));

    res.json({ countries, currencies });
  } catch (error) {
    console.error('Erro ao buscar dados do formulário:', error);
    res.status(500).json({ countries: [], currencies: [] });
  }
});

app.post('/payments', requireLogin, (req, res) => {
  let {
    tipo_pagamento,
    nome,
    banco,
    id_conta,
    tipo_conta,
    moeda,
    pais,
    nome_cartao,
    id_cartao,
    moeda_dinheiro
  } = req.body;

  // Função segura para limpar campos
  function sanitizeField(field) {
    if (typeof field === 'object') {
      try {
        if (field.code) return String(field.code);
        return Array.isArray(field) ? String(field[0]) : JSON.stringify(field);
      } catch {
        return '';
      }
    }
    return String(field || '');
  }

  // Corrige campos com base na aba ativa
  if (tipo_pagamento === 'cartao_credito') {
    nome = sanitizeField(nome_cartao);
    id_conta = sanitizeField(id_cartao);
    banco = '';
    tipo_conta = '';
    pais = '';
    moeda = '';
  } else if (tipo_pagamento === 'dinheiro') {
    nome = 'Cash';
    banco = '';
    id_conta = '';
    tipo_conta = '';
    pais = '';
    moeda = sanitizeField(moeda_dinheiro);
  } else if (tipo_pagamento === 'conta_bancaria') {
    nome = sanitizeField(nome);
    banco = sanitizeField(banco);
    id_conta = sanitizeField(id_conta);
    tipo_conta = sanitizeField(tipo_conta);
    moeda = sanitizeField(moeda);
    pais = sanitizeField(pais);
  }

  // Validação
  if (tipo_pagamento === 'conta_bancaria') {
    if (!nome || !banco || !id_conta || !tipo_conta || !moeda || !pais) {
      return res.status(400).send('Please fill in all required fields for Bank Account.');
    }
  } else if (tipo_pagamento === 'cartao_credito') {
    if (!nome || !id_conta) {
      return res.status(400).send('Please fill in all required fields for Credit Card.');
    }
  } else if (tipo_pagamento === 'dinheiro') {
    if (!moeda) {
      return res.status(400).send('Please select a currency for Cash.');
    }
  } else {
    return res.status(400).send('Invalid payment type.');
  }

  // Inserção no banco
  db.run(
    `INSERT INTO Payments (tipo_pagamento, nome, banco, id_conta, tipo_conta, moeda, pais) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [tipo_pagamento, nome, banco, id_conta, tipo_conta, moeda, pais],
    (err) => {
      if (err) {
        console.error('Error creating payment method:', err);
        return res.status(500).send('Failed to create payment method. Please try again later.');
      }
      console.log('Payment method successfully created!');
      res.redirect('/payments');
    }
  );
});

app.post('/payments/:id/delete', requireLogin, (req, res) => {
  const id = req.params.id;

  db.run('DELETE FROM Payments WHERE id = ?', [id], (err) => {
    if (err) {
      console.error('Error deleting payment method:', err);
      return res.status(500).send('Failed to delete payment method. Please try again later.');
    }
    console.log(`Payment method with ID ${id} deleted successfully.`);
    res.redirect('/payments');
  });
});

app.get('/payments/:id/edit', requireLogin, async (req, res) => {
  const id = req.params.id;

  db.get('SELECT * FROM Payments WHERE id = ?', [id], async (err, payment) => {
    if (err || !payment) {
      console.error('Erro ao buscar método de pagamento:', err);
      return res.status(500).send('Erro ao carregar método de pagamento.');
    }

    try {
      // Países
      const countriesRes = await fetch('https://restcountries.com/v3.1/all');
      const countriesData = await countriesRes.json();
      const countries = countriesData.map(country => ({
        code: country.cca2,
        name: country.name.common
      })).sort((a, b) => a.name.localeCompare(b.name));

      // Moedas
      const currenciesRes = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
      const currenciesData = await currenciesRes.json();
      const currencies = Object.keys(currenciesData.rates).map(code => ({
        code: code,
        name: code
      })).sort((a, b) => a.code.localeCompare(b.code));

      res.render('payment-edit', {
        payment,
        countries,
        currencies,
        lang: req.session.language || 'en'
      });
    } catch (error) {
      console.error('Erro ao carregar países e moedas:', error);
      res.status(500).send('Erro ao preparar edição.');
    }
  });
});

app.get('/payments/:id/json', requireLogin, async (req, res) => {
  const id = req.params.id;

  db.get('SELECT * FROM Payments WHERE id = ?', [id], async (err, payment) => {
    if (err || !payment) {
      return res.status(404).json({ error: 'Payment method not found.' });
    }

    try {
      // Países
      const countriesRes = await fetch('https://restcountries.com/v3.1/all');
      const countriesData = await countriesRes.json();
      const countries = countriesData.map(c => ({
        code: c.cca2,
        name: c.name.common
      })).sort((a, b) => a.name.localeCompare(b.name));

      // Moedas
      const currenciesRes = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
      const currenciesData = await currenciesRes.json();
      const currencies = Object.keys(currenciesData.rates).map(code => ({
        code,
        name: code
      })).sort((a, b) => a.code.localeCompare(b.code));

      res.json({ payment, countries, currencies });
    } catch (error) {
      console.error('Erro ao buscar dados para edição:', error);
      res.status(500).json({ error: 'Failed to fetch form data.' });
    }
  });
});

app.post('/payments/:id/edit', requireLogin, (req, res) => {
  const id = req.params.id;
  let {
    tipo_pagamento,
    nome,
    banco,
    id_conta,
    tipo_conta,
    moeda,
    pais,
    nome_cartao,
    id_cartao,
    moeda_dinheiro
  } = req.body;

  // Sanitização
  function sanitizeField(field) {
    if (typeof field === 'object') {
      try {
        if (field.code) return String(field.code);
        return Array.isArray(field) ? String(field[0]) : JSON.stringify(field);
      } catch {
        return '';
      }
    }
    return String(field || '');
  }

  if (tipo_pagamento === 'cartao_credito') {
    nome = sanitizeField(nome_cartao);
    id_conta = sanitizeField(id_cartao);
    banco = '';
    tipo_conta = '';
    pais = '';
    moeda = '';
  } else if (tipo_pagamento === 'dinheiro') {
    nome = 'Cash';
    banco = '';
    id_conta = '';
    tipo_conta = '';
    pais = '';
    moeda = sanitizeField(moeda_dinheiro);
  } else if (tipo_pagamento === 'conta_bancaria') {
    nome = sanitizeField(nome);
    banco = sanitizeField(banco);
    id_conta = sanitizeField(id_conta);
    tipo_conta = sanitizeField(tipo_conta);
    pais = sanitizeField(pais);
    moeda = sanitizeField(moeda);
  }

  db.run(
    `UPDATE Payments SET nome = ?, banco = ?, id_conta = ?, tipo_conta = ?, moeda = ?, pais = ? WHERE id = ?`,
    [nome, banco, id_conta, tipo_conta, moeda, pais, id],
    (err) => {
      if (err) {
        console.error('Erro ao atualizar método de pagamento:', err);
        return res.status(500).send('Erro ao atualizar método de pagamento.');
      }
      console.log(`Método de pagamento ${id} atualizado com sucesso.`);
      res.redirect('/payments');
    }
  );
});



app.get('/logout', (req, res) => {
  // Lógica para encerrar a sessão do usuário (ex: destruir a sessão)
  req.session.destroy((err) => {
    if (err) {
      console.log(err);
    }
    // Redirecionar o usuário para a página de login
    res.redirect('/login');
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`SmartExpense rodando em http://localhost:${PORT}`);
});
