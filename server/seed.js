// Seeds a starter organization so you can log in immediately.
// Safe to run every time the app starts: it skips seeding if an
// organization already exists.
require('dotenv').config();
const db = require('./db');
const { hashPassword } = require('./auth');

async function run() {
  await db.migrate();
  const existing = await db.prepare('SELECT COUNT(*) as c FROM organizations').get();
  if (existing.c > 0) {
    console.log('Database already seeded - skipping.');
    return;
  }

  await db.transaction(async (tx) => {
    const orgId = (await tx.prepare('INSERT INTO organizations (name) VALUES (?)').run('Macelleria')).lastInsertRowid;
    const locationId = (await tx.prepare('INSERT INTO locations (org_id, name, address) VALUES (?,?,?)')
      .run(orgId, 'Macelleria MERRYLANDS', 'Merrylands NSW')).lastInsertRowid;

    const positionNames = ['Front of House', 'Chef Burger/Salad', 'Chef Grill', 'Prep/Kitchen Hand', 'Manager', 'Runner'];
    const positionIds = [];
    for (let i = 0; i < positionNames.length; i++) {
      const id = (await tx.prepare('INSERT INTO positions (org_id, name, sort_order) VALUES (?,?,?)').run(orgId, positionNames[i], i)).lastInsertRowid;
      positionIds.push(id);
    }

    const ownerEmail = process.env.SEED_OWNER_EMAIL || 'abidash081@gmail.com';
    const ownerPassword = process.env.SEED_OWNER_PASSWORD || 'ChangeMe123!';
    const ownerId = (await tx.prepare(`INSERT INTO users (org_id, name, email, phone, password_hash, role, pay_rate, can_view_wages, notify_email, notify_sms)
        VALUES (?,?,?,?,?, 'admin', 0, 1, 1, 1)`)
      .run(orgId, 'Owner/Admin', ownerEmail.toLowerCase(), null, hashPassword(ownerPassword))).lastInsertRowid;
    await tx.prepare('INSERT INTO employee_locations (employee_id, location_id) VALUES (?,?)').run(ownerId, locationId);

    // A couple of demo employees so the schedule isn't empty on first login.
    // Replace these with your real staff from the Organization page.
    const demoStaff = [
      { name: 'Demo Employee One', email: 'demo.employee1@example.com', phone: '+61400000001', position: 'Front of House', pay_rate: 28 },
      { name: 'Demo Employee Two', email: 'demo.employee2@example.com', phone: '+61400000002', position: 'Chef Burger/Salad', pay_rate: 32 }
    ];
    for (const s of demoStaff) {
      const posId = positionIds[positionNames.indexOf(s.position)];
      const empId = (await tx.prepare(`INSERT INTO users (org_id, name, email, phone, password_hash, role, pay_rate, can_view_wages, notify_email, notify_sms)
          VALUES (?,?,?,?,?, 'employee', ?, 0, 1, 1)`)
        .run(orgId, s.name, s.email, s.phone, hashPassword('Password123!'), s.pay_rate)).lastInsertRowid;
      await tx.prepare('INSERT INTO employee_locations (employee_id, location_id) VALUES (?,?)').run(empId, locationId);
      await tx.prepare('INSERT INTO employee_positions (employee_id, position_id) VALUES (?,?)').run(empId, posId);
    }

    console.log('Seeded organization "Macelleria" with location, positions and demo staff.');
    console.log(`Log in as owner: ${ownerEmail} / ${ownerPassword}`);
    console.log('Demo employees: demo.employee1@example.com / Password123!, demo.employee2@example.com / Password123!');
  });
}

module.exports = { run };

if (require.main === module) {
  run().then(() => process.exit(0)).catch(err => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}
