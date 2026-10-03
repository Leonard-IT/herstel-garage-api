'use strict';

const { TableClient } = require('@azure/data-tables');

const PARTITION_KEY = 'garage';
let clientPromise;

function getClient() {
  if (!clientPromise) {
    const connection = process.env.GARAGE_TABLE_CONNECTION || 'UseDevelopmentStorage=true';
    const tableName = process.env.GARAGE_TABLE_NAME || 'garages';
    const client = TableClient.fromConnectionString(connection, tableName, {
      allowInsecureConnection: connection.includes('UseDevelopmentStorage'),
    });
    clientPromise = client.createTable().then(() => client);
    clientPromise.catch(() => { clientPromise = undefined; });
  }
  return clientPromise;
}

/**
 * Persists a new garage registration (status "pending").
 * The KvK number is the row key, so a duplicate registration throws with statusCode 409.
 */
async function createGarage(garage) {
  const client = await getClient();
  const { contact, specializations, accreditations, liftCount, ...rest } = garage;
  const id = garage.kvkNumber;
  const entity = {
    partitionKey: PARTITION_KEY,
    rowKey: id,
    ...rest,
    contactFirstName: contact.firstName,
    contactLastName: contact.lastName,
    contactJobTitle: contact.jobTitle,
    contactEmail: contact.email,
    contactPhone: contact.phone,
    specializations: JSON.stringify(specializations),
    accreditations: JSON.stringify(accreditations),
    status: 'pending',
    registeredAt: new Date().toISOString(),
  };
  if (liftCount !== null) entity.liftCount = liftCount;
  await client.createEntity(entity);
  return { id, status: entity.status, registeredAt: entity.registeredAt };
}

module.exports = { createGarage };
