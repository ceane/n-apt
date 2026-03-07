# FCC ULS Tower Data

This directory contains tower and cellular data downloaded from the FCC Universal Licensing System (ULS) database.

## File Descriptions

### Cell Tower Specific Files
- **`a_cell.zip`** - Cell tower applications (29MB)
  - Contains pending and approved applications for cellular tower licenses
  - Includes new tower construction, modifications, and license transfers
  - Data includes: location coordinates, tower height, ownership, technical specifications

- **`l_cell.zip`** - Cell tower licenses (15MB)
  - Contains active cellular tower licenses
  - Current operational cell towers with license details
  - Data includes: license numbers, frequencies, service areas, licensee information

### General Tower Files (Include Cell Towers)
- **`a_tower.zip`** - Tower applications (204MB)
  - All tower type applications (cellular, broadcast, microwave, etc.)
  - Comprehensive tower construction and modification applications
  - Data includes: structure type, height, coordinates, engineering details

- **`l_tower.zip`** - Tower licenses (77MB)
  - All active tower licenses across all services
  - Current operational towers of all types
  - Data includes: license details, technical parameters, ownership

### Reference and Update Files
- **`d_tower.zip`** - Tower daily updates (54MB)
  - Daily changes to tower database
  - New registrations, modifications, cancellations
  - Useful for incremental updates

- **`r_tower.zip`** - Tower reference data (37MB)
  - Reference tables and lookup data
  - Standardized codes, service types, regulatory information
  - Supporting data for main tower files

## Data Format
All files are ZIP archives containing:
- **DAT files** - Fixed-width text format data files
- **PDF files** - Documentation and field descriptions
- **README files** - FCC-specific documentation

## Common Data Fields
- **Location** - Latitude/longitude coordinates
- **Height** - Tower structure height above ground
- **Owner** - Licensee and tower owner information
- **Frequencies** - Operating frequency ranges
- **Service Type** - Cellular, broadcast, microwave, etc.
- **License Status** - Active, pending, cancelled

## Usage
Extract files with:
```bash
unzip *.zip -d extracted/
```

## Data Source
- **Source**: FCC Universal Licensing System (ULS)
- **URL**: ftp://wirelessftp.fcc.gov/pub/uls/complete/
- **Update Frequency**: Daily for daily files, monthly for complete files
- **Last Downloaded**: [Run date]

## Notes
- Coordinates are in decimal degrees (NAD83)
- Heights are in meters above ground level
- License status reflects current FCC database state
- Some files may contain sensitive ownership information
