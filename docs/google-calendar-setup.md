# Conexión con Google Calendar

Giman Eventos 360 sincroniza cada ficha con:

1. `Eventos Maestro · Grupo Giman`.
2. El calendario propio del local, cuando está configurado.

La sincronización se ejecuta desde el panel en modo edición. No se publican en Calendar datos de contacto, importes, alergias, notas privadas ni instrucciones de proveedores.

## Preparación única en Google Cloud

1. Crear o elegir un proyecto en Google Cloud.
2. Activar **Google Calendar API**.
3. Crear una **cuenta de servicio**.
4. Crear una clave JSON para esa cuenta y guardarla de forma segura.
5. Compartir los calendarios de destino con el correo de la cuenta de servicio y permiso **Hacer cambios en eventos**.

No hay que añadir la clave JSON al repositorio.

## Variables del entorno alojado

Configurar estas variables como secretos o valores del entorno de Sites:

| Variable | Tipo | Valor |
| --- | --- | --- |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Secreto | `client_email` del JSON de la cuenta de servicio |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_B64` | Secreto | Campo `private_key` del JSON, codificado completo en Base64 |
| `GOOGLE_CALENDAR_MASTER_ID` | Normal | ID del calendario maestro |

Calendario maestro actual:

```text
3abe59d71070c5d7fb086808ea0a877ee0b198f3af0383908283fc7968a1dd67@group.calendar.google.com
```

Vive Roda ya tiene configurado su calendario local en la base de datos. Olympic, Torre del Rame y Tapeoteca se sincronizarán al maestro hasta que se añada el ID exacto de su calendario local.

## Funcionamiento

- Los eventos sin horario se crean como reservas de día completo.
- Con hora inicial y final se usa la zona `Europe/Madrid`.
- Si la hora final es anterior a la inicial, se interpreta que termina al día siguiente.
- Los estados confirmados u operativos bloquean disponibilidad; las opciones y presupuestos quedan transparentes.
- Los reintentos actualizan el mismo evento de Google gracias a un identificador determinista.
- La sincronización masiva bloquea fichas exactamente duplicadas para evitar dobles reservas.

## Puesta en marcha

1. Entrar en modo edición.
2. Abrir una ficha y comprobar el bloque **Google Calendar**.
3. Ejecutar primero una sincronización individual de prueba.
4. Verificar el evento en el calendario maestro y, para Vive Roda, también en el calendario local.
5. Usar **Sincronizar pendientes** para el resto.

Si Google muestra un error de permisos, revisar que ambos calendarios se hayan compartido con el correo exacto de la cuenta de servicio.
