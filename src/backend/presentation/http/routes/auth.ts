// Auth routes. login/register are public (public rate limiter when supplied); /me is
// protected by the JWT auth middleware.

import { Router, type RequestHandler } from 'express';
import type { AuthController } from '../controllers/AuthController';
import { asyncHandler } from '../middleware/asyncHandler';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { validateBody } from '../middleware/ValidationMiddleware';
import { loginSchema, registerSchema } from '../validation/schemas';

const passthrough: RequestHandler = (_req, _res, next) => next();

export function createAuthRoutes(
  controller: AuthController,
  publicLimiter: RequestHandler = passthrough,
): Router {
  const router = Router();
  router.post('/login', publicLimiter, validateBody(loginSchema), asyncHandler(controller.login));
  router.post(
    '/register',
    publicLimiter,
    validateBody(registerSchema),
    asyncHandler(controller.register),
  );
  router.get('/me', authMiddleware, asyncHandler(controller.me));
  return router;
}
