# SkillBridge Backend

## What is SkillBridge?

SkillBridge is a tutoring platform that helps students find suitable tutors, choose an available time, and manage learning sessions in one place. This repository contains the backend that protects the platform's rules and keeps its information consistent.

## Who is it for?

### Students

Students can explore approved tutors, compare subjects, prices, ratings, and experience, check available session times, and book a suitable lesson. They can view their own bookings, cancel eligible upcoming sessions, and review a tutor after a completed lesson.

### Tutors

Tutors can create a teaching profile, select the subjects they teach, set a recurring weekly schedule, and manage sessions assigned to them. A tutor becomes publicly discoverable only after an administrator approves a complete profile.

### Administrators

Administrators oversee the platform. They can review tutor applications, manage subject categories, inspect users and bookings, ban or restore accounts, view platform statistics, and correct booking statuses when necessary.

## How the platform works

1. A student or tutor creates an account.
2. A tutor completes a profile and weekly availability.
3. An administrator reviews the tutor before the profile becomes public.
4. A student finds an approved tutor and chooses a time and session length.
5. A valid booking is confirmed immediately.
6. Before a session begins, the student or assigned tutor may cancel it.
7. After the session ends, the tutor can mark it complete.
8. The student may then leave one permanent review of the completed session.

Available times are calculated consistently for everyone, while visitors can still view them in the local time shown by their application.

## Core capabilities

- Public discovery of approved, active tutors.
- Search and sorting by subject, price, rating, and review activity.
- Tutor profiles with multiple teaching subjects.
- Recurring weekly tutor availability.
- Student-selected session lengths and clear quoted prices.
- Immediate booking confirmation with protection against overlapping sessions.
- Role-aware booking history, cancellation, and completion.
- One review per completed, student-owned booking.
- Live tutor rating and review totals.
- User, tutor, category, booking, and dashboard administration.

## Safety and trust

SkillBridge verifies permissions for protected actions and checks current account status whenever a user accesses private platform features. A banned user can still see that their account is banned, but cannot continue using protected student, tutor, or administrator operations.

Tutor profiles must be approved before students can discover or book them. Booking conflicts are prevented even when requests arrive at nearly the same time. Reviews are tied to completed sessions and cannot be edited or removed through the platform in this release.

Sensitive credentials are not returned in normal platform responses or intentionally included in application logs. The service also uses request limits and standard web security protections to reduce abuse.

## What is not included

This release does not include:

- Payment processing, checkout, refunds, invoices, or tutor payouts.
- Messaging or live chat.
- Video calls, meeting links, or lesson hosting.
- Calendar-provider synchronization.
- Recurring bookings.
- Coupons or discounts.
- Review editing or deletion.
- Public administrator registration.

## Project status

The backend supports the planned SkillBridge account, tutor, availability, booking, review, and administration workflows. Automated checks cover the main success, validation, authorization, and conflict scenarios.

## For developers

For local setup, configuration, database workflows, project structure, API organization, and testing instructions, see the [Developer documentation](docs/DEVELOPMENT.md).
