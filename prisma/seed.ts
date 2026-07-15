import { prisma } from '../src/config/db.js';
import { auth } from '../src/auth/auth.js';
import { env } from '../src/config/env.js';

function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function main() {
  let adminPassword = '';
  try {
    if (!env.ADMIN_NAME || !env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
      console.error('❌ Error: Missing required admin configuration (ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD).');
      process.exit(1);
    }

    if (env.ADMIN_PASSWORD.length < 8) {
      console.error('❌ Error: ADMIN_PASSWORD must be at least 8 characters long.');
      process.exit(1);
    }

    const adminEmail = env.ADMIN_EMAIL;
    const adminName = env.ADMIN_NAME;
    adminPassword = env.ADMIN_PASSWORD;

    console.log(`Seeding admin user: ${adminEmail}...`);

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: adminEmail },
    });

    if (existingUser) {
      console.log(`User with email "${adminEmail}" already exists.`);
      
      // Ensure the role is ADMIN and status is ACTIVE.
      // Do not downgrade their role if they are already ADMIN.
      if (existingUser.role !== 'ADMIN') {
        console.log(`Upgrading existing user to ADMIN...`);
        await prisma.user.update({
          where: { id: existingUser.id },
          data: {
            role: 'ADMIN',
            status: 'ACTIVE',
            emailVerified: true,
          },
        });
        console.log(`Successfully upgraded user to ADMIN.`);
      } else {
        console.log(`User is already an ADMIN. No changes made.`);
      }
    } else {
      console.log(`Creating new admin user...`);
      // Create user with 'STUDENT' role first to pass the registration hook
      const result = await auth.api.signUpEmail({
        body: {
          email: adminEmail,
          password: adminPassword,
          name: adminName,
          role: 'STUDENT',
        },
      });

      if (!result || !result.user) {
        throw new Error('Failed to create user via Better Auth signUpEmail.');
      }

      // Update the role to ADMIN, status to ACTIVE and emailVerified to true in database
      await prisma.user.update({
        where: { id: result.user.id },
        data: {
          role: 'ADMIN',
          status: 'ACTIVE',
          emailVerified: true,
        },
      });

      console.log(`Successfully created and seeded ADMIN user: ${adminEmail}`);
    }

    console.log('✅ Seeding completed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed with error:');
    const errMessage = error instanceof Error ? error.message : String(error);
    const sanitizedMessage = adminPassword
      ? errMessage.replace(new RegExp(escapeRegExp(adminPassword), 'g'), '[REDACTED]')
      : errMessage;
    console.error(sanitizedMessage);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
