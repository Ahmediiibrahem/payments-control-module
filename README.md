# Payments Control Module

Internal web-based module for **controlling cash requests, payments, and email follow-ups**, built using **Vanilla JavaScript** and **Google Sheets (CSV)**, and deployed on **GitHub Pages**.

---

## Overview

The module is designed to give **full visibility and control over cash exposure** inside the organization by:

- Tracking payment requests and transfers
- Analyzing email-based payment follow-ups
- Monitoring remaining cash exposure
- Providing executive insights (SLA, aging, bottlenecks)
- Allowing drill-down from summary → email → row level
- Restricting access through a simple login page

The system is **frontend-only**, with no backend or database.

---

## Tech Stack

- HTML5
- CSS (single unified stylesheet)
- Vanilla JavaScript (ES Modules)
- Google Sheets (CSV export)
- PapaParse (local copy)
- GitHub Pages (served from `/docs`)

---

## Project Structure

payments-control-module/
├─ README.md
└─ docs/
├─ index.html # Cash Control Dashboard
├─ email-analysis.html # Email Analysis
├─ insights.html # Executive Insights
├─ login.html # Login page
│
├─ assets/
│ ├─ favicon.png
│ ├─ old-favicon.png
│ ├─ css/
│ │ └─ main.css # Unified styling
│ └─ vendor/
│ └─ papaparse.min.js # Local CSV parser
│
└─ src/
├─ app.js # Dashboard logic
├─ email_analysis.js # Email analysis logic
├─ insights.js # Insights & KPIs logic
├─ auth.js # Login & access control
├─ config.js # Data source URLs
└─ schema.js # CSV column mapping

yaml
Copy code

---

## Pages

### 1. Cash Control Dashboard (`index.html`)
- High-level totals
- Cash requested, paid, and remaining
- Filtering by sector, project, status, and date range

---

### 2. Email Analysis (`email-analysis.html`)
- Last 15 actual activity days (based on real data)
- Email-level grouping
- Drill-down per email
- Detailed tables and modals

---

### 3. Executive Insights (`insights.html`)

#### Executive Summary
- Total requests (after canceled)
- Total paid
- Total remaining
- SLA (≤ 5 days) **calculated by values, not counts**

#### Cash Exposure
Four KPIs:
1. Without approval & not transferred  
2. Approved & not transferred  
3. Approved & transferred (partial remaining)  
4. Total remaining (after canceled)

Each KPI:
- Shows monetary value
- Shows **true email count**
- Clickable → modal with drill-down
- Nested drill-down (summary → email → details) with back navigation

#### Additional Insights
- Aging analysis
- Top bottleneck projects
- Weekly payment pattern
- Simple cash forecast
- Data quality indicators

---

### 4. Login (`login.html`)
- Simple username/password
- Session-based protection
- All main pages require authentication

> This is **basic access control**, intended for internal use only.

---

## Core Business Logic

- **Effective Amount**
effective_total = amount_total - amount_canceled

markdown
Copy code

- **Remaining**
remaining = max(0, effective_total - amount_paid)

yaml
Copy code

- **SLA (≤ 5 Days)**
- Calculated only for completed payments
- Based on **paid amounts**, not number of emails
- Measures: payment request date → payment date

- **Email Count**
- Counted as grouped emails
- Not raw row count

---

## Deployment

- Hosted using **GitHub Pages**
- Pages root: `/docs`
- No build step required

---

## Notes

- Any change in Google Sheet columns must be reflected in `schema.js`
- Dates must be clean to ensure correct SLA and aging results
- PapaParse is stored locally to avoid browser tracking/CDN issues

---

## Purpose

This project is built to support:
- Financial control
- Cash exposure monitoring
- Operational transparency
- Better decision-making
