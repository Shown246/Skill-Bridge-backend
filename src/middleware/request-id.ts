import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const reqId = `req_${uuidv4().replace(/-/g, '')}`;
  req.requestId = reqId;
  res.setHeader('x-request-id', reqId);
  next();
};

export default requestIdMiddleware;
