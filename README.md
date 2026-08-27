# DigitalSAN

Sistema web para gestionar un San / cadena de ahorro informal: creación de San (monetario o
personalizado), participantes, selección y sorteo de números, calendario automático de fechas,
cobros y pagos con conversión automática a bolívares, y recordatorios por WhatsApp.

Interfaz "glass liquid", pensada como app móvil (navegación inferior, sin scrolls innecesarios).

## Estructura

```
digitalsan/
├── index.html            Lobby / inicio de sesión (participante, creador, admin)
├── admin.html             Panel del administrador
├── creador.html           Panel del creador de San
├── participante.html      Panel del participante
├── assets/css/styles.css  Sistema de diseño (glass liquid)
├── assets/js/config.js    Credenciales de Supabase (edítalo)
├── assets/js/utils.js     Fechas, moneda, WhatsApp, RIF, toasts
├── assets/js/rate-service.js  Tasa USDT/VES
├── assets/js/auth.js      Sesión de admin/creador (Supabase Auth) y participante (RPC propio)
└── database/schema.sql    Esquema completo de Supabase (tablas, funciones, RLS)
```

## Puesta en marcha (una sola vez)

1. **Crea un proyecto gratis en [supabase.com](https://supabase.com).**
2. En **SQL Editor → New query**, pega y ejecuta todo el contenido de `database/schema.sql`.
   Esto crea las tablas, las políticas de seguridad (RLS), las funciones de login/creación de
   participantes y el bucket de almacenamiento `comprobantes` para las capturas de pago.
3. En **Project Settings → API**, copia tu **Project URL** y tu **anon public key** y pégalas en
   `assets/js/config.js`.
4. Crea tu usuario **administrador**:
   - En **Authentication → Users → Add user**, crea el correo y contraseña del admin.
   - Copia su UUID y ejecútalo en el SQL Editor (reemplaza los valores):
     ```sql
     insert into perfiles (auth_user_id, rol, nombre_completo, whatsapp, email)
     values ('UUID-COPIADO', 'admin', 'Tu nombre', '58412xxxxxxx', 'tu@correo.com');
     ```
5. Sube la carpeta completa a tu hosting (o ábrela localmente con `index.html`).

## Flujo de uso

- **Admin** (`admin.html`): registra creadores (primero crea el usuario en Supabase Auth, luego
  lo vincula desde el panel), ve todos los San y participantes, y define una tasa manual de
  respaldo.
- **Creador** (`creador.html`): crea uno o más San (monetario o personalizado con artículo),
  define cuota, número de cupos, frecuencia (semanal/quincenal/mensual) y fecha de inicio — el
  sistema calcula automáticamente la fecha de cada turno y la fecha de finalización. Crea
  participantes (nombre, RIF, WhatsApp, dirección) generando una contraseña temporal que se
  comparte por WhatsApp con un toque. Asigna números manualmente, deja que el participante elija
  (método "libre") o ejecuta un sorteo entre los participantes que elija. Valida los pagos
  reportados y envía recordatorios de pago por WhatsApp con un toque.
- **Participante** (`participante.html`): al iniciar sesión por primera vez, si su San usa
  asignación "libre", se le abre automáticamente el panel para elegir su número entre los
  disponibles. Ve su cuota, fechas, su turno de cobro, el San completo y la tasa USDT/VES
  actualizada. Reporta sus pagos (referencia + captura) para que el creador los valide.

## Tasa USDT / VES

Se obtiene automáticamente desde `https://ve.dolarapi.com/v1/dolares/paralelo` (dólar paralelo,
referenciado al mercado P2P de Binance). Binance no ofrece un endpoint público con CORS habilitado
para consultarlo directamente desde el navegador, así que se usa esta fuente pública y sin
autenticación, con caché de 10 minutos. Si la petición falla, se usa el último valor guardado o la
tasa manual que definas en el panel de administrador.

## Nota de seguridad

El login del participante es propio (RIF + contraseña, vía una función de base de datos), no usa
Supabase Auth, por lo que algunas políticas de seguridad (RLS) quedan más abiertas de lo ideal para
permitir que el participante tome un número o reporte un pago sin iniciar sesión "real". Es
suficiente para un lanzamiento controlado, pero si vas a manejar montos grandes te recomiendo
migrar el login de participantes a Supabase Auth (correo sintético + Edge Function) para políticas
más estrictas por usuario.

---
© DigitalSAN — Powered by **gabora646** · WhatsApp: +58 422‑874‑5777
