# PUMA Inventory Scanner (O24 POC)

Phone-based receiving scanner for PUMA Works. Point the camera at a shipping
label, and the box is logged into the PUMA Inventory SharePoint lists with its
location. If the tracking number matches an expected shipment, the package is
marked received and the app reports "package N of M" so partial deliveries
surface immediately.

## How it fits together

- **This app** (static, GitHub Pages): camera barcode scanning, manual entry,
  and an "add expected shipment" form.
- **Power Automate flow** "PUMA Inventory Intake (O24)": the only writer. The
  app POSTs JSON to the flow's HTTP trigger; the flow writes to SharePoint.
- **SharePoint lists** on the Artificial Intelligence site: Orders, Packages,
  Scans, Locations. The lists ARE the dashboard (native views, M365 auth).

The flow URL is injected at build time from the `VITE_FLOW_URL` repository
secret, and can be overridden per device from the app's settings panel.

## Development

```bash
npm install
npm test
npm run dev
```

## Status

Proof of concept for the Friday review cadence. Production upgrades planned:
real user auth via an IT-registered Entra app, email-driven expected shipments
from a dedicated receiving mailbox, and MaintainX sync.
