export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(details: { field: string; message: string }[]) {
    super(400, 'Validation failed', details);
  }
}

/** Deliberately generic: never reveals whether the email exists. */
export class InvalidCredentialsError extends AppError {
  constructor() {
    super(401, 'Invalid email or password');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to access this resource') {
    super(403, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, message);
  }
}
