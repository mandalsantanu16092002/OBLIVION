import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { loginSchema, registerSchema, type Role } from '@onboardiq/shared';
import { pool } from '../db/pool';
import { ah, conflict, parseOr422, unauthorized } from '../lib/http';
import { authenticate, signToken } from '../middleware/auth';
import { rateLimit } from '../middleware/common';
import { audit } from '../services/audit';

export const authRouter = Router();

const userDto = (u: any) => ({ id: u.id, email: u.email, full_name: u.full_name, roles: u.roles as Role[] });

authRouter.post(
  '/register',
  rateLimit(20, 60_000),
  ah(async (req, res) => {
    const body = parseOr422(registerSchema, req.body);
    const hash = await bcrypt.hash(body.password, 10);
    try {
      const r = await pool.query(
        "INSERT INTO users (email, password_hash, full_name, roles) VALUES ($1,$2,$3,ARRAY['APPLICANT']) RETURNING id, email, full_name, roles",
        [body.email, hash, body.full_name],
      );
      const u = r.rows[0];
      await audit({ event_type: 'USER_REGISTERED', actor_id: u.id, actor_email: u.email, actor_role: 'APPLICANT', ip: req.ip });
      res.status(201).json({ token: signToken({ id: u.id, email: u.email, name: u.full_name, roles: u.roles }), user: userDto(u) });
    } catch (e: any) {
      if (e?.code === '23505') throw conflict('An account with this email already exists. Please log in.');
      throw e;
    }
  }),
);

authRouter.post(
  '/login',
  rateLimit(10, 60_000, (r) => `${r.ip}|${String(r.body?.email ?? '').toLowerCase()}`),
  ah(async (req, res) => {
    const body = parseOr422(loginSchema, req.body);
    const r = await pool.query('SELECT * FROM users WHERE email = $1 AND is_active', [body.email]);
    const u = r.rows[0];
    const ok = u ? await bcrypt.compare(body.password, u.password_hash) : false;
    if (!u || !ok) {
      await audit({ event_type: 'LOGIN_FAILED', actor_email: body.email, actor_role: 'UNKNOWN', ip: req.ip });
      throw unauthorized('Invalid email or password');
    }
    await audit({ event_type: 'LOGIN', actor_id: u.id, actor_email: u.email, actor_role: u.roles[0], ip: req.ip });
    res.json({ token: signToken({ id: u.id, email: u.email, name: u.full_name, roles: u.roles }), user: userDto(u) });
  }),
);

authRouter.get(
  '/me',
  authenticate,
  ah(async (req, res) => {
    const r = await pool.query('SELECT id, email, full_name, roles FROM users WHERE id = $1', [req.user!.id]);
    if (!r.rows[0]) throw unauthorized();
    res.json({ user: userDto(r.rows[0]) });
  }),
);
