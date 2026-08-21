# UI layer, DI wiring and tests. See write_templates.py for why these live in a script.
import io, os

T = {}

# --------------------------------------------------------------------------- navigation

T['kt/ui/AppRoot.kt.tmpl'] = r'''package {{PACKAGE}}.ui

import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import {{PACKAGE}}.ui.items.ItemsScreen
import {{PACKAGE}}.ui.navigation.ItemsRoute
{{#if prefs}}
import {{PACKAGE}}.ui.navigation.SettingsRoute
import {{PACKAGE}}.ui.settings.SettingsScreen
{{/if}}

/**
 * Single navigation host for the app. Routes are type-safe: destinations are @Serializable
 * objects rather than strings, so a typo is a compile error and arguments keep their types.
 */
@Composable
fun AppRoot() {
    val navController = rememberNavController()

    NavHost(navController = navController, startDestination = ItemsRoute) {
        composable<ItemsRoute> {
{{#if prefs}}
            ItemsScreen(onOpenSettings = { navController.navigate(SettingsRoute) })
{{else}}
            ItemsScreen()
{{/if}}
        }
{{#if prefs}}
        composable<SettingsRoute> {
            SettingsScreen(onBack = { navController.popBackStack() })
        }
{{/if}}
    }
}
'''

T['kt/ui/navigation/Routes.kt.tmpl'] = r'''package {{PACKAGE}}.ui.navigation

import kotlinx.serialization.Serializable

/**
 * Type-safe Navigation Compose routes. Add parameters as constructor properties and they are
 * serialised into the back stack automatically.
 */
@Serializable
data object ItemsRoute
{{#if prefs}}

@Serializable
data object SettingsRoute
{{/if}}
'''

# --------------------------------------------------------------------------- items feature

T['kt/ui/items/ItemsUiState.kt.tmpl'] = r'''package {{PACKAGE}}.ui.items

import androidx.compose.runtime.Immutable
import {{PACKAGE}}.domain.model.Item

/**
 * Everything the items screen needs to render, in one immutable snapshot.
 * @Immutable lets Compose skip recomposition when the instance is unchanged.
 */
@Immutable
data class ItemsUiState(
    val items: List<Item> = emptyList(),
    val isLoading: Boolean = true,
) {
    val isEmpty: Boolean get() = !isLoading && items.isEmpty()
}
'''

T['kt/ui/items/ItemsViewModel.kt.tmpl'] = r'''package {{PACKAGE}}.ui.items

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import {{PACKAGE}}.domain.repository.ItemRepository
{{#if noDi}}
import {{PACKAGE}}.di.ServiceLocator
{{/if}}
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
{{#if hilt}}
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
{{/if}}

/**
 * Unidirectional data flow: the repository is the source of truth, the ViewModel exposes a
 * single immutable [ItemsUiState], and the UI sends events back as function calls.
 */
{{#if hilt}}
@HiltViewModel
class ItemsViewModel @Inject constructor(
    private val itemRepository: ItemRepository,
) : ViewModel() {
{{/if}}
{{#if koin}}
class ItemsViewModel(
    private val itemRepository: ItemRepository,
) : ViewModel() {
{{/if}}
{{#if noDi}}
class ItemsViewModel(
    private val itemRepository: ItemRepository = ServiceLocator.itemRepository,
) : ViewModel() {
{{/if}}

    val uiState: StateFlow<ItemsUiState> = itemRepository.observeItems()
        .map { items -> ItemsUiState(items = items, isLoading = false) }
        .stateIn(
            scope = viewModelScope,
            // Keep collecting briefly across configuration changes, then stop to save work.
            started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
            initialValue = ItemsUiState(),
        )

    fun addItem(label: String) {
        val trimmed = label.trim()
        if (trimmed.isEmpty()) return
        viewModelScope.launch { itemRepository.addItem(trimmed) }
    }

    fun clearItems() {
        viewModelScope.launch { itemRepository.clearItems() }
    }

    private companion object {
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
'''

T['kt/ui/items/ItemsScreen.kt.tmpl'] = r'''package {{PACKAGE}}.ui.items

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import {{PACKAGE}}.domain.model.Item
import {{PACKAGE}}.ui.theme.AppTheme
{{#if hilt}}
import androidx.hilt.navigation.compose.hiltViewModel
{{/if}}
{{#if koin}}
import org.koin.androidx.compose.koinViewModel
{{/if}}
{{#if noDi}}
import androidx.lifecycle.viewmodel.compose.viewModel
{{/if}}

/**
 * Stateful entry point: owns the ViewModel and hoists state down to a stateless composable,
 * which is what makes [ItemsContent] previewable and testable on its own.
 */
@Composable
fun ItemsScreen(
{{#if prefs}}
    onOpenSettings: () -> Unit,
{{/if}}
    modifier: Modifier = Modifier,
{{#if hilt}}
    viewModel: ItemsViewModel = hiltViewModel(),
{{/if}}
{{#if koin}}
    viewModel: ItemsViewModel = koinViewModel(),
{{/if}}
{{#if noDi}}
    viewModel: ItemsViewModel = viewModel(),
{{/if}}
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    ItemsContent(
        uiState = uiState,
        onAddItem = viewModel::addItem,
        onClearItems = viewModel::clearItems,
{{#if prefs}}
        onOpenSettings = onOpenSettings,
{{/if}}
        modifier = modifier,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ItemsContent(
    uiState: ItemsUiState,
    onAddItem: (String) -> Unit,
    onClearItems: () -> Unit,
{{#if prefs}}
    onOpenSettings: () -> Unit,
{{/if}}
    modifier: Modifier = Modifier,
) {
    var draft by rememberSaveable { mutableStateOf("") }

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = { Text("{{APP_NAME}}") },
{{#if prefs}}
                actions = {
                    IconButton(onClick = onOpenSettings) {
                        Icon(Icons.Default.Settings, contentDescription = "Settings")
                    }
                },
{{/if}}
            )
        },
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    label = { Text("New item") },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                FilledIconButton(
                    onClick = {
                        onAddItem(draft)
                        draft = ""
                    },
                    enabled = draft.isNotBlank(),
                ) {
                    Icon(Icons.Default.Add, contentDescription = "Add item")
                }
            }

            HorizontalDivider()

            when {
                uiState.isLoading -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator()
                }

                uiState.isEmpty -> Text(
                    text = "Nothing here yet. Add your first item above.",
                    style = MaterialTheme.typography.bodyMedium,
                )

                else -> {
                    LazyColumn(modifier = Modifier.weight(1f)) {
                        items(uiState.items, key = { it.id }) { item ->
                            ListItem(headlineContent = { Text(item.label) })
                        }
                    }
                    TextButton(onClick = onClearItems) {
                        Text("Clear all")
                    }
                }
            }
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun ItemsContentPreview() {
    AppTheme {
        ItemsContent(
            uiState = ItemsUiState(
                items = listOf(Item(1, "Buy milk"), Item(2, "Ship the app")),
                isLoading = false,
            ),
            onAddItem = {},
            onClearItems = {},
{{#if prefs}}
            onOpenSettings = {},
{{/if}}
        )
    }
}
'''

# --------------------------------------------------------------------------- settings feature

T['kt/ui/settings/SettingsUiState.kt.tmpl'] = r'''package {{PACKAGE}}.ui.settings

import androidx.compose.runtime.Immutable

@Immutable
data class SettingsUiState(
    /** null means no explicit choice has been made yet - follow the system setting. */
    val darkTheme: Boolean? = null,
    val displayName: String = "",
)
'''

T['kt/ui/settings/SettingsViewModel.kt.tmpl'] = r'''package {{PACKAGE}}.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import {{PACKAGE}}.domain.repository.UserPreferencesRepository
{{#if noDi}}
import {{PACKAGE}}.di.ServiceLocator
{{/if}}
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
{{#if hilt}}
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
{{/if}}

{{#if hilt}}
@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val userPreferencesRepository: UserPreferencesRepository,
) : ViewModel() {
{{/if}}
{{#if koin}}
class SettingsViewModel(
    private val userPreferencesRepository: UserPreferencesRepository,
) : ViewModel() {
{{/if}}
{{#if noDi}}
class SettingsViewModel(
    private val userPreferencesRepository: UserPreferencesRepository =
        ServiceLocator.userPreferencesRepository,
) : ViewModel() {
{{/if}}

    val uiState: StateFlow<SettingsUiState> = userPreferencesRepository.preferences
        .map { prefs ->
            SettingsUiState(darkTheme = prefs.darkTheme, displayName = prefs.displayName)
        }
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
            initialValue = SettingsUiState(),
        )

    fun setDarkTheme(enabled: Boolean) {
        viewModelScope.launch { userPreferencesRepository.setDarkTheme(enabled) }
    }

    fun setDisplayName(name: String) {
        viewModelScope.launch { userPreferencesRepository.setDisplayName(name) }
    }

    private companion object {
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
'''

T['kt/ui/settings/SettingsScreen.kt.tmpl'] = r'''package {{PACKAGE}}.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import {{PACKAGE}}.ui.theme.AppTheme
{{#if hilt}}
import androidx.hilt.navigation.compose.hiltViewModel
{{/if}}
{{#if koin}}
import org.koin.androidx.compose.koinViewModel
{{/if}}
{{#if noDi}}
import androidx.lifecycle.viewmodel.compose.viewModel
{{/if}}

/**
 * Settings persist through Preferences DataStore, so they survive process death - relaunch
 * the app and the toggle keeps its value.
 */
@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
{{#if hilt}}
    viewModel: SettingsViewModel = hiltViewModel(),
{{/if}}
{{#if koin}}
    viewModel: SettingsViewModel = koinViewModel(),
{{/if}}
{{#if noDi}}
    viewModel: SettingsViewModel = viewModel(),
{{/if}}
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    SettingsContent(
        uiState = uiState,
        onDarkThemeChange = viewModel::setDarkTheme,
        onDisplayNameChange = viewModel::setDisplayName,
        onBack = onBack,
        modifier = modifier,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsContent(
    uiState: SettingsUiState,
    onDarkThemeChange: (Boolean) -> Unit,
    onDisplayNameChange: (String) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = { Text("Settings") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ListItem(
                headlineContent = { Text("Dark theme") },
                supportingContent = {
                    Text(if (uiState.darkTheme == null) "Following system" else "Set manually")
                },
                trailingContent = {
                    Switch(
                        checked = uiState.darkTheme ?: false,
                        onCheckedChange = onDarkThemeChange,
                    )
                },
            )

            OutlinedTextField(
                value = uiState.displayName,
                onValueChange = onDisplayNameChange,
                label = { Text("Display name") },
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun SettingsContentPreview() {
    AppTheme {
        SettingsContent(
            uiState = SettingsUiState(darkTheme = true, displayName = "Vee"),
            onDarkThemeChange = {},
            onDisplayNameChange = {},
            onBack = {},
        )
    }
}
'''

# --------------------------------------------------------------------------- theme

T['kt/ui/theme/Theme.kt.tmpl'] = r'''package {{PACKAGE}}.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext

private val LightColors = lightColorScheme(
    primary = Primary,
    secondary = Secondary,
    tertiary = Tertiary,
)

private val DarkColors = darkColorScheme(
    primary = PrimaryDark,
    secondary = SecondaryDark,
    tertiary = TertiaryDark,
)

@Composable
fun AppTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    // Material You wallpaper colours, available from Android 12.
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit,
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }

        darkTheme -> DarkColors
        else -> LightColors
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = AppTypography,
        content = content,
    )
}
'''

# --------------------------------------------------------------------------- DI

T['kt/di/AppModule.kt.tmpl'] = r'''package {{PACKAGE}}.di

import android.content.Context
{{#if room}}
import androidx.room.Room
import {{PACKAGE}}.data.local.AppDatabase
import {{PACKAGE}}.data.local.ItemDao
{{/if}}
{{#if prefs}}
import {{PACKAGE}}.data.preferences.UserPreferencesDataSource
{{/if}}
{{#if retrofit}}
import {{PACKAGE}}.data.remote.ApiClient
import {{PACKAGE}}.data.remote.ExampleApi
{{/if}}
{{#if ktor}}
import {{PACKAGE}}.data.remote.ApiClient
{{/if}}
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
{{#if ktor}}
import io.ktor.client.HttpClient
{{/if}}
import javax.inject.Singleton

/**
 * Provides framework types the app does not own and therefore cannot annotate with @Inject.
 * Types we do own are bound in [RepositoryModule] with @Binds instead.
 */
@Module
@InstallIn(SingletonComponent::class)
object AppModule {
{{#if room}}

    @Provides
    @Singleton
    fun provideAppDatabase(@ApplicationContext context: Context): AppDatabase =
        Room.databaseBuilder(context, AppDatabase::class.java, AppDatabase.NAME).build()

    @Provides
    fun provideItemDao(database: AppDatabase): ItemDao = database.itemDao()
{{/if}}
{{#if prefs}}

    @Provides
    @Singleton
    fun provideUserPreferencesDataSource(
        @ApplicationContext context: Context,
    ): UserPreferencesDataSource = UserPreferencesDataSource(context)
{{/if}}
{{#if retrofit}}

    @Provides
    @Singleton
    fun provideExampleApi(): ExampleApi = ApiClient.exampleApi()
{{/if}}
{{#if ktor}}

    @Provides
    @Singleton
    fun provideHttpClient(): HttpClient = ApiClient.httpClient()
{{/if}}
}
'''

T['kt/di/RepositoryModule.kt.tmpl'] = r'''package {{PACKAGE}}.di

import {{PACKAGE}}.data.repository.DefaultItemRepository
import {{PACKAGE}}.domain.repository.ItemRepository
{{#if prefs}}
import {{PACKAGE}}.data.repository.DefaultUserPreferencesRepository
import {{PACKAGE}}.domain.repository.UserPreferencesRepository
{{/if}}
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * @Binds rather than @Provides: Dagger wires the implementation directly to the interface with
 * no factory method generated at all, which is both faster and less code.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class RepositoryModule {

    @Binds
    @Singleton
    abstract fun bindItemRepository(impl: DefaultItemRepository): ItemRepository
{{#if prefs}}

    @Binds
    @Singleton
    abstract fun bindUserPreferencesRepository(
        impl: DefaultUserPreferencesRepository,
    ): UserPreferencesRepository
{{/if}}
}
'''

T['kt/di/KoinModule.kt.tmpl'] = r'''package {{PACKAGE}}.di

{{#if room}}
import androidx.room.Room
import {{PACKAGE}}.data.local.AppDatabase
import {{PACKAGE}}.data.local.ItemDao
{{/if}}
{{#if prefs}}
import {{PACKAGE}}.data.preferences.UserPreferencesDataSource
import {{PACKAGE}}.data.repository.DefaultUserPreferencesRepository
import {{PACKAGE}}.domain.repository.UserPreferencesRepository
import {{PACKAGE}}.ui.settings.SettingsViewModel
{{/if}}
{{#if network}}
import {{PACKAGE}}.data.remote.ApiClient
{{/if}}
import {{PACKAGE}}.data.repository.DefaultItemRepository
import {{PACKAGE}}.domain.repository.ItemRepository
import {{PACKAGE}}.ui.items.ItemsViewModel
import org.koin.android.ext.koin.androidContext
import org.koin.androidx.viewmodel.dsl.viewModel
import org.koin.dsl.module

val appModule = module {
{{#if room}}
    single {
        Room.databaseBuilder(androidContext(), AppDatabase::class.java, AppDatabase.NAME).build()
    }
    single<ItemDao> { get<AppDatabase>().itemDao() }
    single<ItemRepository> { DefaultItemRepository(get()) }
{{else}}
    single<ItemRepository> { DefaultItemRepository() }
{{/if}}
{{#if prefs}}

    single { UserPreferencesDataSource(androidContext()) }
    single<UserPreferencesRepository> { DefaultUserPreferencesRepository(get()) }
{{/if}}
{{#if retrofit}}

    single { ApiClient.exampleApi() }
{{/if}}
{{#if ktor}}

    single { ApiClient.httpClient() }
{{/if}}

    viewModel { ItemsViewModel(get()) }
{{#if prefs}}
    viewModel { SettingsViewModel(get()) }
{{/if}}
}
'''

T['kt/di/ServiceLocator.kt.tmpl'] = r'''package {{PACKAGE}}.di

import android.content.Context
{{#if room}}
import androidx.room.Room
import {{PACKAGE}}.data.local.AppDatabase
{{/if}}
{{#if prefs}}
import {{PACKAGE}}.data.preferences.UserPreferencesDataSource
import {{PACKAGE}}.data.repository.DefaultUserPreferencesRepository
import {{PACKAGE}}.domain.repository.UserPreferencesRepository
{{/if}}
import {{PACKAGE}}.data.repository.DefaultItemRepository
import {{PACKAGE}}.domain.repository.ItemRepository

/**
 * Hand-rolled dependency graph - no DI framework was selected. Initialised once from
 * App.onCreate. Swap this for Hilt or Koin without touching the UI layer, because every
 * consumer depends on the repository interfaces rather than on this object's concrete types.
 */
object ServiceLocator {

    lateinit var itemRepository: ItemRepository
        private set
{{#if prefs}}

    lateinit var userPreferencesRepository: UserPreferencesRepository
        private set
{{/if}}

    fun init(context: Context) {
        val appContext = context.applicationContext
{{#if room}}
        val database = Room.databaseBuilder(
            appContext,
            AppDatabase::class.java,
            AppDatabase.NAME,
        ).build()
        itemRepository = DefaultItemRepository(database.itemDao())
{{else}}
        itemRepository = DefaultItemRepository()
{{/if}}
{{#if prefs}}
        userPreferencesRepository =
            DefaultUserPreferencesRepository(UserPreferencesDataSource(appContext))
{{/if}}
    }
}
'''

# --------------------------------------------------------------------------- tests

T['kt/test/MainDispatcherRule.kt.tmpl'] = r'''package {{PACKAGE}}

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.TestDispatcher
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.rules.TestWatcher
import org.junit.runner.Description

/**
 * viewModelScope runs on Dispatchers.Main, which does not exist in a unit test. This rule
 * swaps it for a test dispatcher around each test.
 */
class MainDispatcherRule(
    private val dispatcher: TestDispatcher = UnconfinedTestDispatcher(),
) : TestWatcher() {

    override fun starting(description: Description) {
        Dispatchers.setMain(dispatcher)
    }

    override fun finished(description: Description) {
        Dispatchers.resetMain()
    }
}
'''

T['kt/test/FakeItemRepository.kt.tmpl'] = r'''package {{PACKAGE}}.data.repository

import {{PACKAGE}}.domain.model.Item
import {{PACKAGE}}.domain.repository.ItemRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * Test double. Possible only because the ViewModel depends on the [ItemRepository] interface
 * rather than on a concrete implementation - no mocking framework needed.
 */
class FakeItemRepository : ItemRepository {

    private val items = MutableStateFlow<List<Item>>(emptyList())
    private var nextId = 1L

    override fun observeItems(): Flow<List<Item>> = items.asStateFlow()

    override suspend fun addItem(label: String) {
        items.update { it + Item(id = nextId++, label = label) }
    }

    override suspend fun clearItems() {
        items.value = emptyList()
    }
}
'''

T['kt/test/ItemsViewModelTest.kt.tmpl'] = r'''package {{PACKAGE}}.ui.items

import app.cash.turbine.test
import {{PACKAGE}}.MainDispatcherRule
import {{PACKAGE}}.data.repository.FakeItemRepository
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ItemsViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val repository = FakeItemRepository()
    private val viewModel = ItemsViewModel(repository)

    @Test
    fun `starts empty once loading finishes`() = runTest {
        viewModel.uiState.test {
            // The first emission is the initial placeholder before the repository responds.
            assertTrue(awaitItem().isLoading)

            val loaded = awaitItem()
            assertFalse(loaded.isLoading)
            assertTrue(loaded.items.isEmpty())
            assertTrue(loaded.isEmpty)
        }
    }

    @Test
    fun `adding an item surfaces it in state`() = runTest {
        viewModel.uiState.test {
            skipItems(2)

            viewModel.addItem("Ship it")

            val state = awaitItem()
            assertEquals(1, state.items.size)
            assertEquals("Ship it", state.items.first().label)
        }
    }

    @Test
    fun `blank labels are ignored`() = runTest {
        viewModel.addItem("   ")
        viewModel.uiState.test {
            skipItems(1)
            assertTrue(awaitItem().items.isEmpty())
        }
    }

    @Test
    fun `clearing removes every item`() = runTest {
        viewModel.addItem("one")
        viewModel.addItem("two")

        viewModel.uiState.test {
            skipItems(1)
            assertEquals(2, awaitItem().items.size)

            viewModel.clearItems()
            assertTrue(awaitItem().items.isEmpty())
        }
    }
}
'''

for path, body in T.items():
    full = os.path.join('templates', path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    io.open(full, 'w', encoding='utf-8', newline='\n').write(body)
    print('wrote', path)
