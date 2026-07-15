import { jest, describe, it, expect, beforeAll, beforeEach, afterAll } from '@jest/globals';
import { exec } from 'child_process';
import { promisify } from 'util';
import { prisma } from '../src/config/db.js';

jest.setTimeout(45000);

const execAsync = promisify(exec);

describe('Idempotent Admin Seed Script Integration Tests', () => {
  const seedCommand = 'npx tsx prisma/seed.ts';
  const testAdminEmail = 'test-seed-admin@example.com';
  const testAdminName = 'Test Seed Admin';
  const testAdminPassword = 'super-strong-password-123';

  // Base environment variables to pass to the seed process
  const baseEnv = {
    ...process.env,
    NODE_ENV: 'test',
    ADMIN_EMAIL: testAdminEmail,
    ADMIN_NAME: testAdminName,
    ADMIN_PASSWORD: testAdminPassword,
  };

  beforeAll(async () => {
    // Make sure we disconnect cleanly and check db is connected
    await prisma.$connect();
  });

  afterAll(async () => {
    // Clean up any test users created by these tests
    await prisma.account.deleteMany({
      where: {
        user: {
          email: testAdminEmail,
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        email: testAdminEmail,
      },
    });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean up before each test to ensure predictable database state
    await prisma.account.deleteMany({
      where: {
        user: {
          email: testAdminEmail,
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        email: testAdminEmail,
      },
    });
  });

  it('should successfully insert the admin user with ADMIN role and ACTIVE status', async () => {
    // Run the seed script via child process
    const { stdout, stderr } = await execAsync(seedCommand, { env: baseEnv });

    expect(stderr).toBe('');
    expect(stdout).toContain('Seeding admin user');
    expect(stdout).toContain('Successfully created and seeded ADMIN user');

    // Retrieve from DB and verify
    const dbUser = await prisma.user.findUnique({
      where: { email: testAdminEmail },
    });

    expect(dbUser).not.toBeNull();
    expect(dbUser?.email).toBe(testAdminEmail);
    expect(dbUser?.name).toBe(testAdminName);
    expect(dbUser?.role).toBe('ADMIN');
    expect(dbUser?.status).toBe('ACTIVE');
    expect(dbUser?.emailVerified).toBe(true);
  });

  it('should be idempotent and not duplicate the user or downgrade their role when run multiple times', async () => {
    // Run 1st time
    await execAsync(seedCommand, { env: baseEnv });

    // Verify user exists and is ADMIN
    const user1 = await prisma.user.findUnique({
      where: { email: testAdminEmail },
    });
    expect(user1?.role).toBe('ADMIN');

    // Run 2nd time
    const { stdout, stderr } = await execAsync(seedCommand, { env: baseEnv });
    expect(stderr).toBe('');
    expect(stdout).toContain('already exists');
    expect(stdout).toContain('already an ADMIN');

    // Verify user still exists, has same ID and is still ADMIN
    const user2 = await prisma.user.findUnique({
      where: { email: testAdminEmail },
    });
    expect(user2).not.toBeNull();
    expect(user2?.id).toBe(user1?.id);
    expect(user2?.role).toBe('ADMIN');
  });

  it('should upgrade an existing non-admin user with the same email to ADMIN role', async () => {
    // Create an existing STUDENT user in the database
    // Better Auth requires user + account or just user if we use raw insertion.
    // For simplicity, we just create the User record directly with STUDENT role
    const existingUser = await prisma.user.create({
      data: {
        id: 'existing-test-user-id-123',
        email: testAdminEmail,
        name: testAdminName,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        role: 'STUDENT',
        status: 'ACTIVE',
      },
    });

    expect(existingUser.role).toBe('STUDENT');

    // Run seed script
    const { stdout, stderr } = await execAsync(seedCommand, { env: baseEnv });
    expect(stderr).toBe('');
    expect(stdout).toContain('already exists');
    expect(stdout).toContain('Upgrading existing user to ADMIN');

    // Verify user is upgraded to ADMIN
    const dbUser = await prisma.user.findUnique({
      where: { email: testAdminEmail },
    });

    expect(dbUser?.id).toBe(existingUser.id);
    expect(dbUser?.role).toBe('ADMIN');
    expect(dbUser?.status).toBe('ACTIVE');
    expect(dbUser?.emailVerified).toBe(true);
  });

  it('should exit non-zero if the configuration is invalid (short password or invalid email) and never print the password', async () => {
    // 1. Invalid Email
    const invalidEmailEnv = {
      ...baseEnv,
      ADMIN_EMAIL: 'invalid-email-address',
    };

    let errorThrown: any = null;
    try {
      await execAsync(seedCommand, { env: invalidEmailEnv });
    } catch (err) {
      errorThrown = err;
    }

    expect(errorThrown).not.toBeNull();
    expect(errorThrown.code).not.toBe(0); // Exit non-zero
    expect(errorThrown.message).toContain('ADMIN_EMAIL');
    expect(errorThrown.message).not.toContain(testAdminPassword);

    // 2. Short Password
    const shortPasswordEnv = {
      ...baseEnv,
      ADMIN_PASSWORD: 'short',
    };

    errorThrown = null;
    try {
      await execAsync(seedCommand, { env: shortPasswordEnv });
    } catch (err) {
      errorThrown = err;
    }

    expect(errorThrown).not.toBeNull();
    expect(errorThrown.code).not.toBe(0); // Exit non-zero
    expect(errorThrown.message).toContain('ADMIN_PASSWORD');
    expect(errorThrown.message).not.toContain('short'); // Make sure actual value isn't printed
  });
});
