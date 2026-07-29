const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const app = express();
const PORT = 4000;
const JWT_SECRET = 'credicontrol_secreto_super_seguro_2026';

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

// 1. RUTA DE REGISTRO DE USUARIOS/COMERCIOS
app.post('/api/auth/registro', async (req, res) => {
  const { nombre, email, password } = req.body;

  if (!nombre || !email || !password) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  }

  try {
    db.get('SELECT * FROM usuarios WHERE email = ?', [email], async (err, usuarioExiste) => {
      if (err) return res.status(500).json({ error: 'Error en la base de datos' });
      if (usuarioExiste) return res.status(400).json({ error: 'Este correo ya está registrado' });

      const passwordHash = await bcrypt.hash(password, 10);
      const sql = 'INSERT INTO usuarios (nombre, email, password) VALUES (?, ?, ?)';

      db.run(sql, [nombre, email, passwordHash], function (err) {
        if (err) return res.status(500).json({ error: 'Error al registrar el usuario' });

        return res.status(201).json({
          mensaje: 'Usuario registrado exitosamente',
          usuarioId: this.lastID
        });
      });
    });
  } catch (error) {
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// 2. RUTA DE INICIO DE SESIÓN
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña requeridos' });
  }

  db.get('SELECT * FROM usuarios WHERE email = ?', [email], async (err, usuario) => {
    if (err) return res.status(500).json({ error: 'Error en el servidor' });
    if (!usuario) return res.status(400).json({ error: 'Credenciales incorrectas' });

    const passwordValida = await bcrypt.compare(password, usuario.password);
    if (!passwordValida) return res.status(400).json({ error: 'Credenciales incorrectas' });

    const token = jwt.sign({ id: usuario.id, email: usuario.email }, JWT_SECRET, { expiresIn: '8h' });

    return res.json({
      mensaje: 'Inicio de sesión exitoso',
      token,
      usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email }
    });
  });
});

// 3. RUTA PARA CONSULTAR HISTORIAL POR CÉDULA O NOMBRE
app.get('/api/consultar', verificarToken, (req, res) => {
  const { busqueda } = req.query;

  if (!busqueda) return res.status(400).json({ error: 'Término de búsqueda requerido' });

  const sqlCliente = 'SELECT * FROM clientes WHERE cedula LIKE ? OR nombre LIKE ?';
  const parametroBusqueda = `%${busqueda}%`;

  db.all(sqlCliente, [parametroBusqueda, parametroBusqueda], (err, clientes) => {
    if (err) return res.status(500).json({ error: 'Error al consultar cliente' });
    if (!clientes || clientes.length === 0) {
      return res.status(404).json({ mensaje: 'No se encontraron clientes registrados' });
    }

    const promesas = clientes.map(cliente => {
      return new Promise((resolve) => {
        const sqlReportes = `
          SELECT r.id, r.estado, r.monto, r.comentario, r.fecha, u.nombre as negocio_nombre 
          FROM reportes r 
          JOIN usuarios u ON r.usuario_id = u.id 
          WHERE r.cliente_id = ?
          ORDER BY r.fecha DESC
        `;

        db.all(sqlReportes, [cliente.id], (err, reportes) => {
          if (err) reportes = [];
          
          const recomendacion = calcularRecomendacion(reportes);

          resolve({
            cliente,
            recomendacion,
            creditos: reportes
          });
        });
      });
    });

    Promise.all(promesas).then(resultados => {
      res.json({ resultados });
    });
  });
});

// 4. RUTA PARA REGISTRAR REPORTE CREDITICIO
app.post('/api/creditos', verificarToken, (req, res) => {
  const { cedula, nombre, telefono, estado, monto, comentario } = req.body;

  if (!cedula || !nombre || !estado) {
    return res.status(400).json({ error: 'Cédula, nombre y estado son obligatorios' });
  }

  db.get('SELECT * FROM clientes WHERE cedula = ?', [cedula], (err, clienteExistente) => {
    if (err) return res.status(500).json({ error: 'Error al verificar cliente' });

    const guardarReporte = (clienteId) => {
      const sqlReporte = 'INSERT INTO reportes (cliente_id, usuario_id, estado, monto, comentario) VALUES (?, ?, ?, ?, ?)';
      db.run(sqlReporte, [clienteId, req.usuario.id, estado, monto || 0, comentario || ''], function (err) {
        if (err) return res.status(500).json({ error: 'Error al guardar reporte' });
        return res.status(201).json({ mensaje: 'Reporte de crédito registrado correctamente' });
      });
    };

    if (clienteExistente) {
      guardarReporte(clienteExistente.id);
    } else {
      const sqlNuevoCliente = 'INSERT INTO clientes (cedula, nombre, telefono) VALUES (?, ?, ?)';
      db.run(sqlNuevoCliente, [cedula, nombre, telefono || ''], function (err) {
        if (err) return res.status(500).json({ error: 'Error al crear cliente' });
        guardarReporte(this.lastID);
      });
    }
  });
});

// 5. RUTA PARA OBTENER REPORTES PROPIOS DEL COMERCIO
app.get('/api/mis-reportes', verificarToken, (req, res) => {
  const negocioId = req.usuario.id;
  
  const query = `
    SELECT r.id, r.estado, r.monto, r.comentario, r.fecha,
           c.nombre AS cliente_nombre, c.cedula AS cliente_cedula
    FROM reportes r
    JOIN clientes c ON r.cliente_id = c.id
    WHERE r.usuario_id = ?
    ORDER BY r.fecha DESC
  `;

  db.all(query, [negocioId], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Error al obtener tus reportes' });
    }
    res.json({ reportes: rows });
  });
});

// 6. RUTA PARA EDITAR UN REPORTE EXISTENTE
app.put('/api/creditos/:id', verificarToken, (req, res) => {
  const reporteId = req.params.id;
  const negocioId = req.usuario.id;
  const { estado, comentario } = req.body;

  if (!estado) {
    return res.status(400).json({ error: 'El estado es obligatorio' });
  }

  const sql = `
    UPDATE reportes 
    SET estado = ?, comentario = ? 
    WHERE id = ? AND usuario_id = ?
  `;

  db.run(sql, [estado, comentario || '', reporteId, negocioId], function(err) {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Error al actualizar el reporte' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Reporte no encontrado o no autorizado' });
    }

    res.json({ mensaje: 'Reporte actualizado correctamente' });
  });
});

// 7. RUTA PARA ELIMINAR REPORTE PROPIO
app.delete('/api/creditos/:id', verificarToken, (req, res) => {
  const reporteId = req.params.id;
  const negocioId = req.usuario.id;

  db.run('DELETE FROM reportes WHERE id = ? AND usuario_id = ?', [reporteId, negocioId], function(err) {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Error al eliminar reporte' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Reporte no encontrado o no tienes permiso para eliminarlo' });
    }
    
    res.json({ mensaje: 'Reporte eliminado correctamente' });
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor CrediControlRD corriendo en http://localhost:${PORT}`);
});