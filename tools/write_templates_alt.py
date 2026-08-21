# SQLDelight data layer + image-loading usage in the sample.
import io, os

T = {}

T['sq/Item.sq.tmpl'] = r'''-- SQLDelight generates typed Kotlin from this file at build time. The SQL is the source of
-- truth: change a column here and the generated API changes with it, so mismatches are
-- compile errors rather than runtime crashes.

CREATE TABLE item (
    id    INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    label TEXT    NOT NULL
);

selectAll:
SELECT *
FROM item
ORDER BY id DESC;

insert:
INSERT INTO item(label)
VALUES (?);

deleteAll:
DELETE FROM item;
'''

T['kt/data/repository/SqlDelightItemRepository.kt.tmpl'] = r'''package {{PACKAGE}}.data.repository

import app.cash.sqldelight.coroutines.asFlow
import app.cash.sqldelight.coroutines.mapToList
import {{PACKAGE}}.data.local.ItemQueries
import {{PACKAGE}}.domain.model.Item
import {{PACKAGE}}.domain.repository.ItemRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
{{#if hilt}}
import javax.inject.Inject
import javax.inject.Singleton
{{/if}}

/**
 * [ItemQueries] is generated from Item.sq - there is no DAO interface to write.
 * Reads come back as a Flow that re-emits whenever the table changes.
 */
{{#if hilt}}
@Singleton
class DefaultItemRepository @Inject constructor(
    private val itemQueries: ItemQueries,
) : ItemRepository {
{{else}}
class DefaultItemRepository(
    private val itemQueries: ItemQueries,
) : ItemRepository {
{{/if}}

    override fun observeItems(): Flow<List<Item>> =
        itemQueries.selectAll()
            .asFlow()
            .mapToList(Dispatchers.IO)
            .map { rows -> rows.map { Item(id = it.id, label = it.label) } }

    override suspend fun addItem(label: String) = withContext(Dispatchers.IO) {
        itemQueries.insert(label)
    }

    override suspend fun clearItems() = withContext(Dispatchers.IO) {
        itemQueries.deleteAll()
    }
}
'''

for path, body in T.items():
    full = os.path.join('templates', path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    io.open(full, 'w', encoding='utf-8', newline='\n').write(body)
    print('wrote', path)
