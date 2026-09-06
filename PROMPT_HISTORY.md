# Prompt History — Electronics Parts Inventory PWA

Sequential list of user prompts that built this app from scratch.

---

## Session 1: Initial Build (prior conversation)

1. **Create the app** — Electronics parts inventory PWA with Supabase backend, QR scanning, label printing, spreadsheet import

---

## Session 2: GitHub Pages Deployment & Features

### Deployment
2. **Let's publish this app to github.io**
3. **Can I use GitHub Desktop?** (to push workflow file — needed `workflow` scope)
4. **Pushed** (confirmed push via GitHub Desktop)

### Bug Fixes (Static Export)
5. **There seems to be a loading loop when running from github.io** → Fixed `router.replace` in useEffect causing infinite re-renders; switched to `window.history.replaceState`
6. **The camera scan does not show camera after granting permission** → Fixed html5-qrcode container sizing (video had 0 height due to flex layout collapsing the scanner div)
7. **It just shows grey box** → Further fix: used static ref div with explicit `width: 100%` inline style instead of dynamically created div

### Navigation Cleanup
8. **Disable the scan and import buttons for now** → Removed Scan and Import from nav

### Storage Organizer Feature
9. **I also want to add a storage organizer, where we define box sizes (bin count) and if there are empty bins, mark bins empty if needed**
10. **Location is box only. We can treat that field as box id** → Clarified data model
11. **Add a clear in search** → Added X button to clear search input
12. **Can you run the DB script?** → Discovered `npx supabase db push` works via CLI
13. **Check ../NoWires.AI** (looking for Supabase service key) → Not needed, CLI handles auth
14. **That is strange, you created these tables without requiring any key from me** → Confirmed Supabase CLI was used in original session
15. **So you cannot use CLI now?** → Found `npx supabase` works, pushed migration successfully
16. **Create a memory to use npx supabase CLI for future reference** → Saved to memory system

### Storage Fixes
17. **When I set bin count for a box, it still shows empty slots outside the range** → Fixed: limited grid to `bin_count` slots, assigned parts sequentially instead of using item_code as bin position
18. **Deploy** → Confirmed deployment was already done

### UI Improvements
19. **Reimagine the top bar** → Redesigned nav with Lucide icons (Package, Grid3X3, Plus, Tags), labels hidden on mobile
20. **Allow the item code to be editable** → Made item_code an editable input in part form
21. **Update the favicon** → Created IC chip SVG with pins on all 4 sides, generated 192px and 512px PNGs
22. **Also, in add part, let user edit the item code** → Made item_code editable in the queue-based Add Parts page too
23. **In Chrome how do I force refresh of favicon** → Provided instructions, then added explicit `<link rel="icon">` tag (was missing)
24. **The tab still shows old icon** → Fixed by adding `<link rel="icon" href="icon.svg" type="image/svg+xml">`

### Data Query
25. **Can you check what is part B6-115?** → Queried DB: no B6-115 exists, item_code 115 is B8-115 (2.2nF 630V capacitor)

### Sort Feature
26. **In parts list, add a sort by dropdown, id and name** → Added client-side sort dropdown (ID / Name)

### Shared Bins
27. **Let's also add the concept of shared bin. By default a component takes its own bin, but user can allocate a shared bin, show a dropdown with IDs from that box. Both in edit and add part dialog** → Added `bin_number` column, share-bin checkbox with dropdown in part form, amber-highlighted shared bins in grid
28. **Let's also allow the user to configure bin rows/cols in box. Generally 3 rows** → Added `rows` and `cols` columns to boxes table, grid uses configured cols, bin_count auto-calculated from rows × cols
29. **In the edit/add part, the share bin with should have a dropdown of the component name + id, rather than bin number** → Changed dropdown to show "Part Name (#item_code)" instead of raw bin numbers

### Visual Polish
30. **How are we showing shared bin components?** → Discussed options for shared bin display
31. **In the box view, I still see two bins occupied with sharing declared** → Fixed: `sharebin()` action now sets `bin_number` on both the current and target part
32. **Show empty bins as green boxes** → Changed empty bins from dashed gray to solid green
33. **Update part should show a success/fail toast** → Added sonner toast on create/update/failure

### Documentation
34. **Create a super prompt to have this app created, and save it on disk** → Created SUPERPROMPT.md
35. **Also save summary of user prompts in sequence that were used to create this app** → This file
