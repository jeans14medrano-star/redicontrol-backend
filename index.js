const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'credicontrol_secreto_super_seguro_2026';

app.use(cors());
app.use(express.json());

// Middleware para proteger rutas con Token JWT
const verificarToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Acceso denegado, token requerido' });

  jwt.verify(token, JWT_SECRET, (err, usuario) => {
    if (err) return res.status(403).json({ error: 'Token inválido o expirado' });
    req.usuario = usuario;
    next();
  });
};

// Función helper para evaluar el estatus de pago y dar la recomendación
function calcularRecomendacion(reportes) {
  if (!reportes || reportes.length === 0) {
    return '✅ APROBAR - Sin historial negativo registrado';
  }

  const tieneLegal = reportes.some(r => r.estado === 'legal');
  const tieneVencido = reportes.some(r => r.estado === 'vencido');
  const tieneAcuerdo = reportes.some(r => r.estado === 'acuerdo');

  if (tieneLegal) {
    return '🚨 RECHAZAR - Cliente en cobro legal o cuenta incobrable';
  }

  if (tieneVencido) {
    return '⚠️ RECHAZAR - Cliente presenta atrasos de pago vigentes';
  }

  if (tieneAcuerdo) {
    return '🤝 EVALUAR CON PRECAUCIÓN - Cliente posee acuerdos de pago activos';
  }

  return '✅ APROBAR - Cliente al día con sus pagos';
}

// 0. RUTA RAÍZ DE BIENVENIDA
app.get('/', (req, res) => {
  res.json({
    mensaje: '🚀 Servidor de CrediControlRD funcionando correctamente',
    estado: 'Online',
    timestamp: new Date()
  });
});

// 1. RUTA DE REGISTRO DE USUARIOS/COMERCIOS
app.post('/api/auth/registro', async (req, res) => {
  const { nombre, email, password } = req.body;

  if (!nombre || !email || !password) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  }

  try {
    const usuarioExiste = await db.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    if (usuarioExiste.rows.length > 0) {
      return res.status(400).json({ error: 'Este correo ya está registrado' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await db.query(
      'INSERT INTO usuarios (nombre, email, password) VALUES ($1, $2, $3) RETURNING id',
      [nombre, email, passwordHash]
    );

    return res.status(201).json({
      mensaje: 'Usuario registrado exitosamente',
      usuarioId: result.rows[0].id
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Error interno del servidor al registrar' });
  }
});

// 2. RUTA DE INICIO DE SESIÓN
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña requeridos' });
  }

  try {
    const result = await db.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Credenciales incorrectas' });
    }

    const usuario = result.rows[0];
    const passwordValida = await bcrypt.compare(password, usuario.password);
    if (!passwordValida) {
      return res.status(400).json({ error: 'Credenciales incorrectas' });
    }

    const token = jwt.sign({ id: usuario.id, email: usuario.email }, JWT_SECRET, { expiresIn: '8h' });

    return res.json({
      mensaje: 'Inicio de sesión exitoso',
      token,
      usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email }
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Error en el servidor al iniciar sesión' });
  }
});

// 3. RUTA PARA CONSULTAR HISTORIAL POR CÉDULA O NOMBRE
app.get('/api/consultar', verificarToken, async (req, res) => {
  const { busqueda } = req.query;

  if (!busqueda) return res.status(400).json({ error: 'Término de búsqueda requerido' });

  try {
    const parametroBusqueda = `%${busqueda}%`;
    const clientesRes = await db.query(
      'SELECT * FROM clientes WHERE cedula ILIKE $1 OR nombre ILIKE $2',
      [parametroBusqueda, parametroBusqueda]
    );

    if (clientesRes.rows.length === 0) {
      return res.status(404).json({ mensaje: 'No se encontraron clientes registrados' });
    }

    const resultados = await Promise.all(
      clientesRes.rows.map(async (cliente) => {
        const sqlReportes = `
          SELECT r.id, r.estado, r.monto, r.comentario, r.fecha, u.nombre as negocio_nombre 
          FROM reportes r 
          JOIN usuarios u ON r.usuario_id = u.id 
          WHERE r.cliente_id = $1
          ORDER BY r.fecha DESC
        `;
        const reportesRes = await db.query(sqlReportes, [cliente.id]);
        const reportes = reportesRes.rows;
        const recomendacion = calcularRecomendacion(reportes);

        return {
          cliente,
          recomendacion,
          creditos: reportes
        };
      })
    );

    res.json({ resultados });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Error al consultar cliente' });
  }
});

// 4. RUTA PARA REGISTRAR REPORTE CREDITICIO
app.post('/api/creditos', verificarToken, async (req, res) => {
  const { cedula, nombre, telefono, estado, monto, comentario } = req.body;

  if (!cedula || !nombre || !estado) {
    return res.status(400).json({ error: 'Cédula, nombre y estado son obligatorios' });
  }

  try {
    const clienteExistente = await db.query('SELECT * FROM clientes WHERE cedula = $1', [cedula]);
    let clienteId;

    if (clienteExistente.rows.length > 0) {
      clienteId = clienteExistente.rows[0].id;
    } else {
      const nuevoCliente = await db.query(
        'INSERT INTO clientes (cedula, nombre, telefono) VALUES ($1, $2, $3) RETURNING id',
        [cedula, nombre, telefono || '']
      );
      clienteId = nuevoCliente.rows[0].id;
    }

    const sqlReporte = 'INSERT INTO reportes (cliente_id, usuario_id, estado, monto, comentario) VALUES ($1, $2, $3, $4, $5)';
    await db.query(sqlReporte, [clienteId, req.usuario.id, estado, monto || 0, comentario || '']);

    return res.status(201).json({ mensaje: 'Reporte de crédito registrado correctamente' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Error al guardar el reporte' });
  }
});

// 5. RUTA PARA OBTENER REPORTES PROPIOS DEL COMERCIO
app.get('/api/mis-reportes', verificarToken, async (req, res) => {
  const negocioId = req.usuario.id;

  const query = `
    SELECT r.id, r.estado, r.monto, r.comentario, r.fecha,
           c.nombre AS cliente_nombre, c.cedula AS cliente_cedula
    FROM reportes r
    JOIN clientes c ON r.cliente_id = c.id
    WHERE r.usuario_id = $1
    ORDER BY r.fecha DESC
  `;

  try {
    const result = await db.query(query, [negocioId]);
    res.json({ reportes: result.rows });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Error al obtener tus reportes' });
  }
});

// 6. RUTA PARA EDITAR UN REPORTE EXISTENTE
app.put('/api/creditos/:id', verificarToken, async (req, res) => {
  const reporteId = req.params.id;
  const negocioId = req.usuario.id;
  const { estado, comentario } = req.body;

  if (!estado) {
    return res.status(400).json({ error: 'El estado es obligatorio' });
  }

  const sql = `
    UPDATE reportes 
    SET estado = $1, comentario = $2 
    WHERE id = $3 AND usuario_id = $4
  `;

  try {
    const result = await db.query(sql, [estado, comentario || '', reporteId, negocioId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Reporte no encontrado o no autorizado' });
    }

    res.json({ mensaje: 'Reporte actualizado correctamente' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Error al actualizar el reporte' });
  }
});

// 7. RUTA PARA ELIMINAR REPORTE PROPIO
app.delete('/api/creditos/:id', verificarToken, async (req, res) => {
  const reporteId = req.params.id;
  const negocioId = req.usuario.id;

  try {
    const result = await db.query('DELETE FROM reportes WHERE id = $1 AND usuario_id = $2', [reporteId, negocioId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Reporte no encontrado o no tienes permiso para eliminarlo' });
    }

    res.json({ mensaje: 'Reporte eliminado correctamente' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Error al eliminar reporte' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor CrediControlRD corriendo en el puerto ${PORT}`);
});
