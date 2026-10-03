# herstel-garage-api

Azure Functions (Node.js, v4 programming model) backend for SnelHerstel.nl partner garages.
Registrations are stored in Azure Table Storage (Azurite locally).

## Endpoints

### `POST /api/garages/register`

Registers a garage (status `pending`, awaiting verification). The KvK number is the unique key.

```json
{
  "companyName": "Garage Test B.V.",
  "kvkNumber": "12345678",
  "vatNumber": "NL123456789B01",
  "street": "Teststraat 1",
  "postalCode": "1234 AB",
  "city": "Utrecht",
  "website": "https://www.example.nl",
  "contact": {
    "firstName": "Jan",
    "lastName": "Jansen",
    "jobTitle": "Owner",
    "email": "jan@example.nl",
    "phone": "06 12345678"
  },
  "serviceArea": "Utrecht en omgeving",
  "employeeCount": "6-15",
  "liftCount": 4,
  "specializations": ["lakschade", "ev"],
  "accreditations": ["rdw", "bovag"],
  "hasLiabilityInsurance": true,
  "iban": "NL91 ABNA 0417 1643 00",
  "acceptedTerms": true,
  "newsletterOptIn": false
}
```

Optional: `vatNumber`, `website`, `contact.jobTitle`, `employeeCount`, `liftCount`, `specializations`, `accreditations`, `newsletterOptIn`.

| Status | Meaning |
| --- | --- |
| 201 | Registered: `{ id, status, registeredAt }` |
| 400 | Body is not valid JSON |
| 409 | KvK number already registered |
| 422 | Validation failed: `{ error, message, details: { field: message } }` |
| 500 | Unexpected error |

## Local development

Requires Node 20+, [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local) and [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite).

```sh
npm install
cp local.settings.example.json local.settings.json   # if missing
npx azurite --silent --location .azurite &            # table storage emulator
func start                                            # http://localhost:7071
npm test
```

Configuration (`local.settings.json` / app settings): `GARAGE_TABLE_CONNECTION`, `GARAGE_TABLE_NAME`.
