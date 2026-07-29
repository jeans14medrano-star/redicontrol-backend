const { Pool } = require('pg');
require('dotenv').config();

// Conexión a la base de datos PostgreSQL (Supabase)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Requerido para la conexión segura en Render/Supabase
  }
});

// Inicialización de tablas en PostgreSQL
const initDb = async () => {
  try {
    // 1. Tabla de Usuarios
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL
      );
    `);

    // 2. Tabla de Clientes
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clientes (
        id SERIAL PRIMARY KEY,
        cedula VARCHAR(50) UNIQUE NOT NULL,
        nombre VARCHAR(255) NOT NULL,
        telefono VARCHAR(50)
      );
    `);

    // 3. Tabla de Reportes
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reportes (
        id SERIAL PRIMARY KEY,
        cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        estado VARCHAR(20) CHECK (estado IN ('al_dia', 'vencido')) NOT NULL,
        monto NUMERIC DEFAULT 0,
        comentario TEXT,
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('✅ Base de datos PostgreSQL conectada y tablas inicializadas.');
  } catch (err) {
    console.error('❌ Error al inicializar las tablas en PostgreSQL:', err.message);
  }
};

initDb();

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};