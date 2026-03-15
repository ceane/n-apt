# OpenCellID Database Format Documentation

## Overview

OpenCellID is a collaborative database of cell tower locations collected through crowdsourcing. The dataset contains comprehensive cell tower information including radio technology, geographic coordinates, and network identifiers.

**Data Source**: https://opencellid.org/downloads  
**License**: Creative Commons Attribution-ShareAlike 4.0 International License  
**Update Frequency**: Daily (includes last 18 months of observations)  
**Size**: ~900MB zipped, ~3.3GB uncompressed

## File Structure

### Organization
The dataset is split into multiple CSV files by Mobile Country Code (MCC):
```
data/opencellid/
├── 310.csv  # United States (477,749 records)
├── 311.csv  # United States (122,262 records) 
├── 312.csv  # United States (84 records)
├── 313.csv  # United States (6,381 records)
├── 314.csv  # United States (169 records)
└── [other MCC files].csv
```

### Radio Technology Distribution
- **LTE**: 483,851 towers (79.8%)
- **NR** (5G): 108,149 towers (17.8%)
- **UMTS**: 10,308 towers (1.7%)
- **GSM**: 4,337 towers (0.7%)

## CSV Format Specification

### Column Structure
Each CSV row contains 14 comma-separated values:

```
radio,mcc,mnc,lac,cell,range,lon,lat,samples,change,created,updated,averageSignal
```

### Column Definitions

| Column | Name | Type | Description | Example |
|--------|------|------|-------------|---------|
| 1 | radio | String | Radio access technology | GSM, LTE, UMTS, NR |
| 2 | mcc | Integer | Mobile Country Code | 310 (USA) |
| 3 | mnc | Integer | Mobile Network Code | 260, 410, 40 |
| 4 | lac | Integer | Location Area Code | 51051, 21250 |
| 5 | cell | Integer | Cell ID | 44473, 45008913 |
| 6 | range | Integer | Position accuracy in meters (NOT signal coverage) | 0 (exact), -1 (unknown), 100-1000 (typical) |
| 7 | lon | Float | Longitude in decimal degrees | -71.11, -118.4972 |
| 8 | lat | Float | Latitude in decimal degrees | 42.3588, 34.0106 |
| 9 | samples | Integer | Number of samples/measurements | 1033, 5506 |
| 10 | change | Integer | Change flag (1=changed) | 1, 0 |
| 11 | created | Integer | Creation timestamp (Unix epoch) | 1459813819 |
| 12 | updated | Integer | Last update timestamp (Unix epoch) | 1745016670 |
| 13 | averageSignal | Integer | Average signal strength | 0 |

### Data Types and Ranges

#### Radio Technologies
- **GSM**: 2G Global System for Mobile Communications
- **UMTS**: 3G Universal Mobile Telecommunications System  
- **LTE**: 4G Long Term Evolution
- **NR**: 5G New Radio

#### Geographic Coordinates
- **Longitude**: -180.0 to +180.0 (Western hemisphere negative)
- **Latitude**: -90.0 to +90.0 (Northern hemisphere positive)
- **Precision**: Up to 4-7 decimal places

#### Network Identifiers
- **MCC**: 3-digit country codes (310-316 for USA)
- **MNC**: 2-3 digit operator codes within country
- **LAC**: Location Area Code (operator-assigned)
- **Cell ID**: Unique cell identifier within LAC

#### Temporal Data
- **Unix Timestamps**: Seconds since January 1, 1970
- **Range**: 2011 to present (based on data samples)

## Sample Records

### LTE Cell Tower (4G)
```
LTE,310,260,51051,44473,0,-71.11,42.3588,1033,19,1,1459813819,1745016670,0
```
- **Location**: Boston, MA (42.36°N, 71.11°W)
- **Network**: Verizon (MCC 310, MNC 260)
- **Samples**: 1,033 measurements
- **Range**: 0 meters (precise location)

### UMTS Cell Tower (3G)
```
UMTS,311,40,25051,6684846,192,-105.7437,36.154,8103,48,1,1384890308,1746035708,0
```
- **Location**: Near Albuquerque, NM
- **Network**: AT&T (MCC 311, MNC 40)
- **Range**: 192 meters (less precise)

### GSM Cell Tower (2G)
```
GSM,310,260,14,33881,0,-118.4972,34.0106,5506,12,1,1343770116,1741492750,0
```
- **Location**: Los Angeles, CA
- **Network**: Verizon (MCC 310, MNC 260)
- **Samples**: 5,506 measurements

## Carrier Identification

### MCC-MNC Mapping
The combination of MCC and MNC identifies specific carriers:

| MCC | MNC | Carrier | Country |
|-----|-----|---------|---------|
| 310 | 260 | Verizon | USA |
| 310 | 410 | AT&T | USA |
| 311 | 40 | AT&T | USA |
| 312 | 290 | Sprint | USA |
| 312 | 720 | T-Mobile | USA |

### Cross-Reference Resources
- **Wikipedia**: Mobile Country Code listings
- **ITU**: Official MCC assignments
- **Operator databases**: MNC to carrier name mappings

## Data Quality Indicators

### Sample Count
- **High confidence**: 1,000+ samples
- **Medium confidence**: 100-999 samples  
- **Low confidence**: <100 samples

### Position Accuracy (Range Field)

The `range` field indicates the accuracy of the cell position estimate, NOT the signal coverage range:

#### Range Values
- **0**: Exact/precise position (high confidence)
- **-1**: Unknown/unspecified accuracy
- **1-100**: Very accurate positioning (±1-100 meters)
- **100-1000**: Typical accuracy (±100-1000 meters)
- **1000+**: Low accuracy positioning (±1+ km)

#### Distribution in Current Dataset
- **-1**: ~346,127 records (57%) - Unknown accuracy
- **0**: ~253,625 records (42%) - Exact positioning
- **1-1000**: ~6,893 records (1%) - Various accuracy levels

#### Important Notes
- This is **position accuracy**, not signal coverage range
- Based on multiple GPS measurements from user devices
- Higher sample counts generally correlate with better accuracy
- Urban areas tend to have better accuracy than rural areas

### Change Flag
- **1**: Cell information has changed recently
- **0**: Stable configuration

## Usage Examples

### Loading Data (Python)
```python
import pandas as pd

# Load specific MCC file
df = pd.read_csv('data/opencellid/310.csv', header=None,
                 names=['radio', 'mcc', 'mnc', 'lac', 'cell', 'range', 
                        'lon', 'lat', 'samples', 'change', 'created', 'updated', 'averageSignal'])

# Filter by technology
lte_towers = df[df['radio'] == 'LTE']

# Filter by carrier
verizon = df[(df['mcc'] == 310) & (df['mnc'] == 260)]
```

### Geographic Queries
```sql
-- Find towers within 10km of Boston
SELECT * FROM cell_towers 
WHERE lat BETWEEN 42.25 AND 42.45 
  AND lon BETWEEN -71.20 AND -71.00;
```

### Time-based Analysis
```python
# Convert timestamps to datetime
df['created_date'] = pd.to_datetime(df['created'], unit='s')
df['updated_date'] = pd.to_datetime(df['updated'], unit='s')

# Find recently updated towers
recent_updates = df[df['updated_date'] > '2024-01-01']
```

## Comparison with FCC Data

### Advantages of OpenCellID
- **Crowdsourced**: More comprehensive coverage
- **Regular updates**: Daily refresh vs. static FCC data
- **Multiple technologies**: Includes 5G (NR) data
- **Global coverage**: Not limited to US territory
- **Sample counts**: Quality indicators via measurement count

### Limitations
- **User-reported**: May contain inaccuracies
- **Variable precision**: Range values indicate uncertainty
- **No license info**: Lacks FCC licensing details
- **No entity data**: No company/ownership information

### Complementary Use
- **OpenCellID**: Location and technical specifications
- **FCC**: Legal ownership and licensing information
- **Combined**: Complete picture of cellular infrastructure

## Processing Considerations

### File Size Management
- **Chunk processing**: Process by MCC files
- **Memory efficiency**: Stream large files line by line
- **Filtering**: Apply geographic or technology filters early

### Data Validation
```python
# Validate coordinates
valid_coords = df[(df['lat'].between(-90, 90)) & 
                 (df['lon'].between(-180, 180))]

# Remove duplicates
unique_towers = df.drop_duplicates(subset=['mcc', 'mnc', 'lac', 'cell'])
```

### Performance Optimization
- **Indexing**: Create indexes on mcc, mnc, lat, lon
- **Spatial indexing**: Use R-tree for geographic queries
- **Batch processing**: Process in chunks of 10,000 records

## Integration with n-apt

### Current Status
- **Location**: `data/opencellid/` directory
- **Format**: CSV files by MCC
- **Size**: ~606,645 total records across 5 MCC files
- **Technologies**: GSM, UMTS, LTE, NR

### Recommended Integration
1. **Convert to JSON**: For consistency with existing data
2. **Geographic indexing**: Enable fast spatial queries
3. **Carrier lookup**: Add carrier name mapping
4. **Quality filtering**: Filter by sample count and range

### Data Pipeline
```
OpenCellID CSV → Validation → JSON Conversion → Geographic Index → API
```

## API Integration

### OpenCellID API
- **Endpoint**: https://opencellid.org/api/
- **Authentication**: API key required
- **Rate limits**: 2 downloads per token per day
- **Format**: JSON responses

### Example API Call
```bash
curl "https://opencellid.org/cell/get?key=YOUR_API_KEY&mcc=310&mnc=260&lac=51051&cellid=44473"
```

## References

- **OpenCellID Wiki**: https://wiki.opencellid.org/wiki/Database_format
- **Community Forum**: https://community.opencellid.org/
- **Download Portal**: https://opencellid.org/downloads
- **API Documentation**: https://opencellid.org/api/
- **License**: CC BY-SA 4.0

## Future Enhancements

1. **Real-time Updates**: Integrate daily data refresh
2. **Carrier Intelligence**: Enhanced carrier identification
3. **Quality Scoring**: Advanced data quality metrics
4. **Historical Analysis**: Track changes over time
5. **Coverage Maps**: Generate coverage visualizations
6. **Cross-validation**: Verify against other datasets
