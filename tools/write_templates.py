# Writes the Kotlin source templates. Kept as a script so the whole set can be regenerated
# atomically; the shell's heredoc handling corrupts backslashes and ${} in this environment.
import io, os

T = {}

# --------------------------------------------------------------------------- app entry

T['kt/App.kt.tmpl'] = r'''package {{PACKAGE}}

import android.app.Application
{{#if koin}}
import {{PACKAGE}}.di.appModule
{{/if}}
{{#if noDi}}
import {{PACKAGE}}.di.ServiceLocator
{{/if}}
{{#if hilt}}
import dagger.hilt.android.HiltAndroidApp
{{/if}}
{{#if koin}}
import org.koin.android.ext.koin.androidContext
import org.koin.androidx.startup.KoinStartup.onKoinStartup
import org.koin.core.context.startKoin
{{/if}}

{{#if hilt}}
@HiltAndroidApp
class App : Application()
{{/if}}
{{#if koin}}
class App : Application() {

    override fun onCreate() {
        super.onCreate()
        startKoin {
            androidContext(this@App)
            modules(appModule)
        }
    }
}
{{/if}}
{{#if noDi}}
class App : Application() {

    override fun onCreate() {
        super.onCreate()
        ServiceLocator.init(this)
    }
}
{{/if}}
'''

T['kt/MainActivity.kt.tmpl'] = r'''package {{PACKAGE}}

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.getValue
import {{PACKAGE}}.ui.AppRoot
import {{PACKAGE}}.ui.theme.AppTheme
{{#if prefs}}
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import {{PACKAGE}}.ui.settings.SettingsViewModel
{{/if}}
{{#if hilt}}
import dagger.hilt.android.AndroidEntryPoint
{{/if}}
{{#if prefsHilt}}
import androidx.hilt.navigation.compose.hiltViewModel
{{/if}}
{{#if prefsKoin}}
import org.koin.androidx.compose.koinViewModel
{{/if}}
{{#if prefsNoDi}}
import androidx.lifecycle.viewmodel.compose.viewModel
{{/if}}

{{#if hilt}}
@AndroidEntryPoint
{{/if}}
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
{{#if prefs}}
            // Theme preference is read at the root so the whole app recomposes when it changes.
{{#if prefsHilt}}
            val settingsViewModel: SettingsViewModel = hiltViewModel()
{{/if}}
{{#if prefsKoin}}
            val settingsViewModel: SettingsViewModel = koinViewModel()
{{/if}}
{{#if prefsNoDi}}
            val settingsViewModel: SettingsViewModel = viewModel()
{{/if}}
            val settings by settingsViewModel.uiState.collectAsStateWithLifecycle()
            AppTheme(darkTheme = settings.darkTheme ?: isSystemInDarkTheme()) {
                AppRoot()
            }
{{else}}
            AppTheme(darkTheme = isSystemInDarkTheme()) {
                AppRoot()
            }
{{/if}}
        }
    }
}
'''

# --------------------------------------------------------------------------- domain

T['kt/domain/model/Item.kt.tmpl'] = r'''package {{PACKAGE}}.domain.model

/**
 * Domain model. Deliberately independent of Room entities and network DTOs so the UI and
 * business rules never depend on a storage or wire format.
 */
data class Item(
    val id: Long,
    val label: String,
)
'''

T['kt/domain/model/UserPreferences.kt.tmpl'] = r'''package {{PACKAGE}}.domain.model

/**
 * User settings backed by Preferences DataStore.
 *
 * [darkTheme] is nullable on purpose: null means "no explicit choice yet, follow the system",
 * which a plain Boolean cannot express.
 */
data class UserPreferences(
    val darkTheme: Boolean? = null,
    val displayName: String = "",
)
'''

T['kt/domain/repository/ItemRepository.kt.tmpl'] = r'''package {{PACKAGE}}.domain.repository

import {{PACKAGE}}.domain.model.Item
import kotlinx.coroutines.flow.Flow

/**
 * The UI layer depends on this interface, never on a concrete implementation, so storage can
 * be swapped and tests can supply a fake.
 */
interface ItemRepository {

    fun observeItems(): Flow<List<Item>>

    suspend fun addItem(label: String)

    suspend fun clearItems()
}
'''

T['kt/domain/repository/UserPreferencesRepository.kt.tmpl'] = r'''package {{PACKAGE}}.domain.repository

import {{PACKAGE}}.domain.model.UserPreferences
import kotlinx.coroutines.flow.Flow

interface UserPreferencesRepository {

    val preferences: Flow<UserPreferences>

    suspend fun setDarkTheme(enabled: Boolean)

    suspend fun setDisplayName(name: String)
}
'''

# --------------------------------------------------------------------------- data: room

T['kt/data/local/ItemEntity.kt.tmpl'] = r'''package {{PACKAGE}}.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey
import {{PACKAGE}}.domain.model.Item

@Entity(tableName = "items")
data class ItemEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val label: String,
)

fun ItemEntity.toDomain(): Item = Item(id = id, label = label)
'''

T['kt/data/local/ItemDao.kt.tmpl'] = r'''package {{PACKAGE}}.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface ItemDao {

    @Query("SELECT * FROM items ORDER BY id DESC")
    fun observeAll(): Flow<List<ItemEntity>>

    @Insert
    suspend fun insert(item: ItemEntity)

    @Query("DELETE FROM items")
    suspend fun clear()
}
'''

T['kt/data/local/AppDatabase.kt.tmpl'] = r'''package {{PACKAGE}}.data.local

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(entities = [ItemEntity::class], version = 1, exportSchema = true)
abstract class AppDatabase : RoomDatabase() {

    abstract fun itemDao(): ItemDao

    companion object {
        const val NAME = "app.db"
    }
}
'''

# --------------------------------------------------------------------------- data: prefs

T['kt/data/preferences/UserPreferencesDataSource.kt.tmpl'] = r'''package {{PACKAGE}}.data.preferences

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import {{PACKAGE}}.domain.model.UserPreferences
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import java.io.IOException

// One DataStore per file name per process - declaring it as a Context extension is the
// documented way to guarantee that.
private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "user_preferences")

/**
 * Reads and writes the preferences file. Keeps DataStore types out of the rest of the app.
 */
class UserPreferencesDataSource(private val context: Context) {

    private object Keys {
        val DARK_THEME = booleanPreferencesKey("dark_theme")
        val DISPLAY_NAME = stringPreferencesKey("display_name")
    }

    val preferences: Flow<UserPreferences> = context.dataStore.data
        // A corrupt or unreadable file surfaces as IOException; fall back to defaults
        // rather than crashing the app on launch.
        .catch { throwable ->
            if (throwable is IOException) emit(emptyPreferences()) else throw throwable
        }
        .map { prefs ->
            UserPreferences(
                darkTheme = prefs[Keys.DARK_THEME],
                displayName = prefs[Keys.DISPLAY_NAME].orEmpty(),
            )
        }

    suspend fun setDarkTheme(enabled: Boolean) {
        context.dataStore.edit { it[Keys.DARK_THEME] = enabled }
    }

    suspend fun setDisplayName(name: String) {
        context.dataStore.edit { it[Keys.DISPLAY_NAME] = name }
    }
}
'''

# --------------------------------------------------------------------------- data: remote

T['kt/data/remote/ApiClient.kt.tmpl'] = r'''package {{PACKAGE}}.data.remote

{{#if retrofit}}
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
{{/if}}
{{#if ktor}}
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json
{{/if}}

/**
 * Networking is wired and ready; the sample screen does not call it, so the app runs offline.
 */
object ApiClient {

    const val BASE_URL = "https://api.example.com/"

    private val jsonFormat = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }
{{#if retrofit}}

    private val okHttpClient: OkHttpClient = OkHttpClient.Builder()
        .addInterceptor(
            HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC },
        )
        .build()

    fun retrofit(): Retrofit = Retrofit.Builder()
        .baseUrl(BASE_URL)
        .client(okHttpClient)
        .addConverterFactory(jsonFormat.asConverterFactory("application/json".toMediaType()))
        .build()

    fun exampleApi(): ExampleApi = retrofit().create(ExampleApi::class.java)
{{/if}}
{{#if ktor}}

    fun httpClient(): HttpClient = HttpClient(OkHttp) {
        install(ContentNegotiation) {
            json(jsonFormat)
        }
    }
{{/if}}
}
'''

T['kt/data/remote/ExampleApi.kt.tmpl'] = r'''package {{PACKAGE}}.data.remote

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
{{#if retrofit}}
import retrofit2.http.GET
{{/if}}

/** Wire model. Mapped to a domain model before it reaches the UI layer. */
@Serializable
data class ItemDto(
    @SerialName("id") val id: Long,
    @SerialName("title") val title: String,
)
{{#if retrofit}}

interface ExampleApi {

    @GET("items")
    suspend fun items(): List<ItemDto>
}
{{/if}}
'''

# --------------------------------------------------------------------------- data: repos

T['kt/data/repository/DefaultItemRepository.kt.tmpl'] = r'''package {{PACKAGE}}.data.repository

import {{PACKAGE}}.domain.model.Item
import {{PACKAGE}}.domain.repository.ItemRepository
{{#if room}}
import {{PACKAGE}}.data.local.ItemDao
import {{PACKAGE}}.data.local.ItemEntity
import {{PACKAGE}}.data.local.toDomain
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
{{else}}
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
{{/if}}
{{#if hilt}}
import javax.inject.Inject
import javax.inject.Singleton
{{/if}}

{{#if room}}
{{#if hilt}}
@Singleton
class DefaultItemRepository @Inject constructor(
    private val itemDao: ItemDao,
) : ItemRepository {
{{else}}
class DefaultItemRepository(
    private val itemDao: ItemDao,
) : ItemRepository {
{{/if}}

    override fun observeItems(): Flow<List<Item>> =
        itemDao.observeAll().map { entities -> entities.map(ItemEntity::toDomain) }

    override suspend fun addItem(label: String) {
        itemDao.insert(ItemEntity(label = label))
    }

    override suspend fun clearItems() {
        itemDao.clear()
    }
}
{{else}}
/**
 * In-memory implementation. No persistence layer was selected, so state lives for the process
 * lifetime only - swap this for a Room-backed implementation without touching the UI.
 */
{{#if hilt}}
@Singleton
class DefaultItemRepository @Inject constructor() : ItemRepository {
{{else}}
class DefaultItemRepository : ItemRepository {
{{/if}}

    private val items = MutableStateFlow<List<Item>>(emptyList())
    private var nextId = 1L

    override fun observeItems(): Flow<List<Item>> = items.asStateFlow()

    override suspend fun addItem(label: String) {
        items.update { current -> current + Item(id = nextId++, label = label) }
    }

    override suspend fun clearItems() {
        items.value = emptyList()
    }
}
{{/if}}
'''

T['kt/data/repository/DefaultUserPreferencesRepository.kt.tmpl'] = r'''package {{PACKAGE}}.data.repository

import {{PACKAGE}}.data.preferences.UserPreferencesDataSource
import {{PACKAGE}}.domain.model.UserPreferences
import {{PACKAGE}}.domain.repository.UserPreferencesRepository
import kotlinx.coroutines.flow.Flow
{{#if hilt}}
import javax.inject.Inject
import javax.inject.Singleton
{{/if}}

{{#if hilt}}
@Singleton
class DefaultUserPreferencesRepository @Inject constructor(
    private val dataSource: UserPreferencesDataSource,
) : UserPreferencesRepository {
{{else}}
class DefaultUserPreferencesRepository(
    private val dataSource: UserPreferencesDataSource,
) : UserPreferencesRepository {
{{/if}}

    override val preferences: Flow<UserPreferences> = dataSource.preferences

    override suspend fun setDarkTheme(enabled: Boolean) = dataSource.setDarkTheme(enabled)

    override suspend fun setDisplayName(name: String) = dataSource.setDisplayName(name)
}
'''

for path, body in T.items():
    full = os.path.join('templates', path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    io.open(full, 'w', encoding='utf-8', newline='\n').write(body)
    print('wrote', path)
