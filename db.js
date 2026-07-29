const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Archivo de base de datos SQLite
const dbPath = path.resolve(__dirname, 'credicontrol.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error al conectar con SQLite:', err.message);
  } else {
    console.log('✅ Base de datos SQLite conectada correctamente.');
  }
});

db.serialize(() => {
  // 1. Tabla de Usuarios (Negocios / Comercios)
  db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    )
  `);

  // 2. Tabla de Clientes (Personas a consultar)
  db.run(`
    CREATE TABLE IF NOT EXISTS clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cedula TEXT UNIQUE NOT NULL,
      nombre TEXT NOT NULL,
      telefono TEXT
    )
  `);

  // 3. Tabla de Reportes Crediticios
  db.run(`
    CREATE TABLE IF NOT EXISTS reportes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL,
      usuario_id INTEGER NOT NULL,
      estado TEXT CHECK(estado IN ('al_dia', 'vencido')) NOT NULL,
      monto REAL DEFAULT 0,
      comentario TEXT,
      fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(cliente_id) REFERENCES clientes(id),
      FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
    )
  `);
});

module.exports = db;
