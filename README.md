# Cleano Business Portal

A comprehensive inventory tracking and management portal for cleaning businesses. Track product inventory, assign kits to employees, log job usage, and analyze performance metrics.

## Features

### For Admins/Owners

- **Inventory Management**: Add, edit, and track cleaning products with stock levels, costs, and minimum stock alerts
- **Kit Management**: Create bundles of products (kits) and assign them to employees
- **Employee Management**: View employee activity, assign kits, and monitor performance
- **Request Management**: Review and approve/reject employee inventory requests
- **Analytics Dashboard**: View comprehensive reports on product usage, employee performance, and inventory insights

### For Employees

- **Job Logging**: Track jobs with client details and log product usage per job
- **My Kits**: View assigned product kits and their contents
- **Inventory Requests**: Request additional products or kits when running low
- **Job History**: View past jobs and product consumption

## Tech Stack

- **Framework**: Next.js 15 with App Router
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: Better Auth
- **Styling**: Tailwind CSS
- **TypeScript**: For type safety

## Database Schema

### Key Models

- **User**: Authentication and role management (OWNER, ADMIN, EMPLOYEE)
- **Product**: Individual inventory items with stock tracking
- **Kit**: Bundles of products assigned to employees
- **Job**: Work logs with product usage tracking
- **InventoryRequest**: Employee requests for products/kits
- **JobProductUsage**: Tracks product consumption per job

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database
- npm or pnpm

### Installation

1. Clone the repository
2. Install dependencies:

   ```bash
   npm install
   ```

3. Set up your environment variables (create `.env` file):

   ```
   DATABASE_URL="your-postgres-connection-string"
   DIRECT_URL="your-direct-connection-string"
   BETTER_AUTH_SECRET="your-secret-key"
   BETTER_AUTH_URL="http://localhost:3000"
   ```

4. Push the database schema:

   ```bash
   npx prisma db push
   ```

5. Generate Prisma client:

   ```bash
   npx prisma generate
   ```

6. Run the development server:

   ```bash
   npm run dev
   ```

7. Open [http://localhost:3000](http://localhost:3000)

## Usage Guide

### Initial Setup

1. **Sign Up**: Create an owner account through the sign-up page
2. **Add Products**: Navigate to Products and add your cleaning supplies
3. **Create Kits**: Bundle products into kits (e.g., "Basic Cleaning Kit")
4. **Add Employees**: Employees can sign up, then assign them kits from the Employees page

### Daily Operations

#### For Employees:

1. **View Kits**: Check "My Kits" to see assigned products
2. **Log Jobs**:
   - Go to "My Jobs" → "Log New Job"
   - Enter client details
   - Select products used and quantities
   - Submit the job
3. **Request Inventory**: Create requests when running low on products

#### For Admins:

1. **Monitor Inventory**: Check Products page for stock levels and low stock alerts
2. **Review Requests**: Approve/reject employee inventory requests
3. **View Analytics**: Check the Analytics dashboard for insights on:
   - Product usage trends
   - Employee performance
   - Inventory costs
   - Low stock alerts

### User Roles

- **OWNER**: Full access to all features
- **ADMIN**: Full access to all features (can be added by owners)
- **EMPLOYEE**: Limited to job logging, viewing assigned kits, and making requests

## Key Features Explained

### Automatic Stock Management

- When employees log jobs with product usage, stock levels automatically decrease
- Editing or deleting jobs automatically adjusts stock levels back
- Low stock alerts notify when products fall below minimum thresholds

### Kit System

- Create reusable product bundles
- Assign kits to multiple employees
- Track which employees have which kits
- View kit value based on product costs

### Usage Analytics

- Total inventory value tracking
- Product usage statistics (most used products)
- Employee performance metrics
- Cost per job analysis
- Recent activity feed

### Request Workflow

1. Employee submits request (PENDING)
2. Admin reviews and approves/rejects
3. If approved, admin marks as FULFILLED when delivered

## Pages Structure

```
/                          → Landing page (redirects to dashboard if logged in)
/sign-in                   → Login page
/sign-up                   → Registration page
                 → Main dashboard (role-based view)
/inventory        → Product inventory management (Admin)
/kits            → Kit management (Admin)
/employees       → Employee management (Admin)
/requests        → Review inventory requests (Admin)
/analytics       → Analytics dashboard (Admin)
/jobs            → Job logging and history (All users)
/my-kits         → View assigned kits (All users)
/my-requests     → Request inventory (All users)
```

## Development

### Database Management

- **View data**: `npx prisma studio`
- **Create migration**: `npx prisma migrate dev --name description`
- **Push schema**: `npx prisma db push`
- **Reset database**: `npx prisma migrate reset`

### Build for Production

```bash
npm run build
npm start
```

## Future Enhancements

- [ ] Email notifications for low stock alerts
- [ ] Export analytics reports to PDF/CSV
- [ ] Mobile app for employees
- [ ] Barcode scanning for products
- [ ] Scheduled reports
- [ ] Multi-location support
- [ ] Product reorder automation

## License

Private - All rights reserved

## Support

For issues or questions, contact your system administrator.
