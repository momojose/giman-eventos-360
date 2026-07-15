type EventInput = { name?: string; client?: string; venue?: string; date?: string; pax?: number; amount?: number };

async function database() {
  const { env } = await import("cloudflare:workers");
  return env.DB;
}

export async function GET() {
  try {
    const db = await database();
    const count = await db.prepare("SELECT COUNT(*) AS total FROM events").first<{ total: number }>();
    if (!Number(count?.total ?? 0)) {
      await db.batch([
        db.prepare("INSERT OR IGNORE INTO venues (id,name,active) VALUES (1,'Vive Roda',1)"), db.prepare("INSERT OR IGNORE INTO venues (id,name,active) VALUES (2,'Olympic',1)"), db.prepare("INSERT OR IGNORE INTO venues (id,name,active) VALUES (3,'Torre del Rame',1)"), db.prepare("INSERT OR IGNORE INTO venues (id,name,active) VALUES (4,'Tapeoteca',1)"),
        db.prepare("INSERT OR IGNORE INTO clients (id,name) VALUES (1,'Laura Martínez')"), db.prepare("INSERT OR IGNORE INTO clients (id,name) VALUES (2,'Soltec Energías')"), db.prepare("INSERT OR IGNORE INTO clients (id,name) VALUES (3,'María Vidal')"), db.prepare("INSERT OR IGNORE INTO clients (id,name) VALUES (4,'Bodegas Luzón')"), db.prepare("INSERT OR IGNORE INTO clients (id,name) VALUES (5,'Familia Pérez')"),
        db.prepare("INSERT OR IGNORE INTO events (id,client_id,venue_id,name,event_date,guests,status) VALUES (1,1,1,'Boda Martínez · Navarro','18 jul 2026',180,'Confirmado')"), db.prepare("INSERT OR IGNORE INTO events (id,client_id,venue_id,name,event_date,guests,status) VALUES (2,2,2,'Cena corporativa Soltec','22 jul 2026',96,'Operativa')"), db.prepare("INSERT OR IGNORE INTO events (id,client_id,venue_id,name,event_date,guests,status) VALUES (3,3,3,'Aniversario Familia Vidal','25 jul 2026',140,'Pendiente anticipo')"), db.prepare("INSERT OR IGNORE INTO events (id,client_id,venue_id,name,event_date,guests,status) VALUES (4,4,4,'Presentación Bodegas Luzón','29 jul 2026',65,'Presupuesto')"), db.prepare("INSERT OR IGNORE INTO events (id,client_id,venue_id,name,event_date,guests,status) VALUES (5,5,1,'Comunión Vega','2 may 2027',82,'Confirmado')"),
        db.prepare("INSERT INTO budgets (event_id,version,revenue,estimated_cost,status) VALUES (1,1,21600,13200,'accepted')"), db.prepare("INSERT INTO budgets (event_id,version,revenue,estimated_cost,status) VALUES (2,1,9120,6260,'accepted')"), db.prepare("INSERT INTO budgets (event_id,version,revenue,estimated_cost,status) VALUES (3,1,14700,9260,'accepted')"), db.prepare("INSERT INTO budgets (event_id,version,revenue,estimated_cost,status) VALUES (4,1,5850,4785,'sent')"), db.prepare("INSERT INTO budgets (event_id,version,revenue,estimated_cost,status) VALUES (5,1,8200,5100,'accepted')")
      ]);
    }
    const result = await db.prepare(`
      SELECT e.id, e.name, c.name AS client, v.name AS venue, e.event_date AS date,
             e.guests AS pax, e.status,
             COALESCE(b.revenue, 0) AS amount,
             COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.event_id = e.id AND p.status = 'paid'), 0) AS paid,
             COALESCE(b.estimated_cost, 0) AS costs
      FROM events e
      JOIN clients c ON c.id = e.client_id
      JOIN venues v ON v.id = e.venue_id
      LEFT JOIN budgets b ON b.id = (SELECT id FROM budgets WHERE event_id = e.id ORDER BY version DESC LIMIT 1)
      ORDER BY e.id DESC
    `).all();
    return Response.json({ events: result.results });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudieron cargar los eventos" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as EventInput;
    const name = input.name?.trim();
    const clientName = input.client?.trim();
    const venueName = input.venue?.trim();
    const date = input.date?.trim();
    const pax = Number(input.pax ?? 0);
    const amount = Number(input.amount ?? 0);
    if (!name || !clientName || !venueName || !date || pax < 1 || amount < 0) return Response.json({ error: "Faltan datos obligatorios" }, { status: 400 });
    const db = await database();

    let client = await db.prepare("SELECT id FROM clients WHERE name = ? LIMIT 1").bind(clientName).first<{ id: number }>();
    if (!client) {
      const inserted = await db.prepare("INSERT INTO clients (name) VALUES (?)").bind(clientName).run();
      client = { id: Number(inserted.meta.last_row_id) };
    }
    let venue = await db.prepare("SELECT id FROM venues WHERE name = ? LIMIT 1").bind(venueName).first<{ id: number }>();
    if (!venue) {
      const inserted = await db.prepare("INSERT INTO venues (name, active) VALUES (?, 1)").bind(venueName).run();
      venue = { id: Number(inserted.meta.last_row_id) };
    }
    const insertedEvent = await db.prepare("INSERT INTO events (client_id, venue_id, name, event_date, guests, status) VALUES (?, ?, ?, ?, ?, 'Presupuesto')").bind(client.id, venue.id, name, date, pax).run();
    const eventId = Number(insertedEvent.meta.last_row_id);
    await db.prepare("INSERT INTO budgets (event_id, version, revenue, estimated_cost, status) VALUES (?, 1, ?, 0, 'draft')").bind(eventId, amount).run();

    return Response.json({ event: { id: eventId, name, client: clientName, venue: venueName, date, pax, status: "Presupuesto", amount, paid: 0, costs: 0 } }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo crear el evento" }, { status: 500 });
  }
}
