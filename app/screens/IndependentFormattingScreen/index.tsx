import { useCallback, useEffect, useState } from 'react'
import { Alert, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useMMKVBoolean } from 'react-native-mmkv'

import { AppSettings } from '@lib/constants/GlobalValues'
import { useTextFilterStore } from '@lib/hooks/TextFilter'
import { Instructs, InstructType } from '@lib/state/Instructs'
import { Logger } from '@lib/state/Logger'
import { saveStringToDownload } from '@lib/utils/File'
import { snakeToCamel } from '@lib/utils/TextFormat'
import { KeysOfType } from '@lib/utils/Types'

const affixKeys: KeysOfType<InstructType, string>[] = [
    'system_prefix',
    'system_suffix',
    'input_prefix',
    'input_suffix',
    'output_prefix',
    'output_suffix',
    'last_output_prefix',
]

const macroKeys: KeysOfType<InstructType, boolean>[] = [
    'wrap',
    'examples',
    'scenario',
    'names',
    'timestamp',
    'personality',
    'hide_think_tags',
]

const attachmentKeys: KeysOfType<InstructType, boolean>[] = [
    'send_images',
    'send_audio',
    'send_documents',
    'last_image_only',
]

type FieldProps = {
    label: string
    value: string
    onChangeText: (value: string) => void
    multiline?: boolean
}

const Field = ({ label, value, onChangeText, multiline = false }: FieldProps) => (
    <View style={styles.field}>
        <Text style={styles.label}>{label}</Text>
        <TextInput
            value={value ?? ''}
            onChangeText={onChangeText}
            multiline={multiline}
            textAlignVertical={multiline ? 'top' : 'center'}
            style={[styles.input, multiline && styles.multiline]}
            autoCapitalize="none"
            autoCorrect={false}
        />
    </View>
)

type ToggleProps = {
    label: string
    value: boolean
    onValueChange: (value: boolean) => void
}

const Toggle = ({ label, value, onValueChange }: ToggleProps) => (
    <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Switch value={!!value} onValueChange={onValueChange} />
    </View>
)

type ActionProps = { label: string; onPress: () => void; destructive?: boolean }

const Action = ({ label, onPress, destructive = false }: ActionProps) => (
    <TouchableOpacity onPress={onPress} style={[styles.action, destructive && styles.destructiveAction]}>
        <Text style={styles.actionText}>{label}</Text>
    </TouchableOpacity>
)

const IndependentFormattingManager = () => {
    const { t } = useTranslation()
    const currentInstruct = Instructs.useInstruct((state) => state.data)
    const setCurrentInstruct = Instructs.useInstruct((state) => state.setData)
    const loadInstruct = Instructs.useInstruct((state) => state.load)
    const [presetList, setPresetList] = useState<{ id: number; name: string }[]>([])
    const [useTemplate, setUseTemplate] = useMMKVBoolean(AppSettings.UseModelTemplate)
    const textFilter = useTextFilterStore((state) => state.filter)
    const setTextFilter = useTextFilterStore((state) => state.setFilter)
    const sendFilteredText = useTextFilterStore((state) => state.sendFilteredText)
    const setSendFilteredText = useTextFilterStore((state) => state.setSendFilteredText)

    const refreshPresets = useCallback(async () => {
        const list = await Instructs.db.query.instructList()
        setPresetList(list ?? [])
    }, [])

    useEffect(() => {
        void refreshPresets()
    }, [refreshPresets])

    const updateText = (key: KeysOfType<InstructType, string>, value: string) => {
        if (!currentInstruct) return
        setCurrentInstruct({ ...currentInstruct, [key]: value })
    }

    const updateBoolean = (key: KeysOfType<InstructType, boolean>, value: boolean) => {
        if (!currentInstruct) return
        setCurrentInstruct({ ...currentInstruct, [key]: value })
    }

    const save = async () => {
        if (currentInstruct?.id == null) return
        await Instructs.db.mutate.updateInstruct(currentInstruct.id, currentInstruct)
        await refreshPresets()
        Logger.infoToast('Saved')
    }

    const createPreset = async () => {
        if (!currentInstruct) return
        const baseName = `${currentInstruct.name} copy`
        let name = baseName
        let suffix = 2
        while (presetList.some((item) => item.name === name)) name = `${baseName} ${suffix++}`
        const id = await Instructs.db.mutate.createInstruct({ ...currentInstruct, id: undefined, name })
        await refreshPresets()
        await loadInstruct(id)
    }

    const deletePreset = () => {
        if (presetList.length <= 1 || currentInstruct?.id == null) {
            Logger.warnToast(t('formatting.toast.cannotDeleteLastPreset'))
            return
        }
        Alert.alert(
            t('formatting.alert.deleteConfig.title'),
            t('formatting.alert.deleteConfig.description', { name: currentInstruct.name }),
            [
                { text: t('formatting.alert.deleteConfig.cancel'), style: 'cancel' },
                {
                    text: t('formatting.alert.deleteConfig.confirm'),
                    style: 'destructive',
                    onPress: async () => {
                        const deletedId = currentInstruct.id
                        await Instructs.db.mutate.deleteInstruct(deletedId)
                        const next = presetList.find((item) => item.id !== deletedId)
                        await refreshPresets()
                        if (next) await loadInstruct(next.id)
                    },
                },
            ]
        )
    }

    const exportPreset = async () => {
        if (currentInstruct?.id == null) return
        const filename = `${currentInstruct.name || t('formatting.defaultName')}.json`
        await saveStringToDownload(JSON.stringify(currentInstruct, null, 2), filename, 'utf8')
        Logger.infoToast(t('formatting.toast.savedToDownloads', { name: filename }))
    }

    const regenerateDefaults = () => {
        Alert.alert(
            t('formatting.alert.regenerateDefaults.title'),
            t('formatting.alert.regenerateDefaults.description'),
            [
                { text: t('formatting.alert.regenerateDefaults.cancel'), style: 'cancel' },
                {
                    text: t('formatting.alert.regenerateDefaults.confirm'),
                    onPress: async () => {
                        await Instructs.generateInitialDefaults()
                        await refreshPresets()
                    },
                },
            ]
        )
    }

    if (!currentInstruct) {
        return (
            <View style={styles.container}>
                <Text style={styles.title}>{t('formatting.title')}</Text>
                <Text style={styles.help}>{t('formatting.errors.instructDataError')}</Text>
            </View>
        )
    }

    const section = (label: string) => <Text style={styles.section}>{label}</Text>
    const fieldLabel = (key: string) => t('formatting.sections.' + snakeToCamel(key))

    return (
        <View style={styles.container}>
            <Text style={styles.title}>{t('formatting.title')}</Text>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
                {section(t('formatting.selectConfig'))}
                {presetList.map((item) => (
                    <TouchableOpacity
                        key={item.id}
                        style={[styles.preset, item.id === currentInstruct.id && styles.selectedPreset]}
                        onPress={() => {
                            if (item.id !== currentInstruct.id) void loadInstruct(item.id)
                        }}>
                        <Text style={styles.presetText}>{item.name}</Text>
                    </TouchableOpacity>
                ))}
                <View style={styles.actions}>
                    <Action label={t('common.actions.save')} onPress={() => void save()} />
                    <Action label={t('formatting.createConfig')} onPress={() => void createPreset()} />
                    <Action label={t('formatting.exportConfig')} onPress={() => void exportPreset()} />
                    <Action label={t('formatting.deleteConfig')} onPress={deletePreset} destructive />
                    <Action label={t('formatting.regenerateDefaults')} onPress={regenerateDefaults} />
                </View>

                {section(t('instruct.formatting'))}
                <Field label={t('formatting.sections.systemPrompt')} value={currentInstruct.system_prompt} onChangeText={(v) => updateText('system_prompt', v)} multiline />
                <Field label={t('formatting.sections.systemPromptFormat')} value={currentInstruct.system_prompt_format} onChangeText={(v) => updateText('system_prompt_format', v)} multiline />
                {affixKeys.map((key) => (
                    <Field key={key} label={fieldLabel(key)} value={currentInstruct[key] as string} onChangeText={(v) => updateText(key, v)} multiline />
                ))}
                <Field label={t('formatting.sections.stopSequence')} value={currentInstruct.stop_sequence ?? ''} onChangeText={(v) => updateText('stop_sequence', v)} />
                <Toggle label={t('formatting.sections.useCommonStopSequences')} value={currentInstruct.use_common_stop} onValueChange={(v) => updateBoolean('use_common_stop', v)} />

                {section(t('instruct.macros'))}
                {macroKeys.map((key) => (
                    <Toggle key={key} label={fieldLabel(key)} value={currentInstruct[key] as boolean} onValueChange={(v) => updateBoolean(key, v)} />
                ))}
                {section(t('instruct.attachments'))}
                {attachmentKeys.map((key) => (
                    <Toggle key={key} label={fieldLabel(key)} value={currentInstruct[key] as boolean} onValueChange={(v) => updateBoolean(key, v)} />
                ))}

                {section(t('instruct.textformatter.title'))}
                <Text style={styles.help}>{t('instruct.textformatter.description')}</Text>
                {[0, 1, 2, 3].map((value) => (
                    <Toggle
                        key={value}
                        label={t([
                            'formatting.autoformatter.disabled',
                            'formatting.autoformatter.plainActionQuoteSpeech',
                            'formatting.autoformatter.asteriskActionPlainSpeech',
                            'formatting.autoformatter.asteriskActionQuoteSpeech',
                        ][value])}
                        value={currentInstruct.format_type === value}
                        onValueChange={(enabled) => {
                            if (enabled) setCurrentInstruct({ ...currentInstruct, format_type: value })
                        }}
                    />
                ))}

                {section(t('instruct.hiddentext.title'))}
                <Text style={styles.help}>{t('instruct.hiddentext.description')}</Text>
                <Field
                    label={t('instruct.hiddentext.title')}
                    value={textFilter.join('\n')}
                    onChangeText={(value) => setTextFilter(value.split('\n').filter((line) => line.length > 0))}
                    multiline
                />
                <Toggle label={t('instruct.filteredtext.label')} value={sendFilteredText} onValueChange={setSendFilteredText} />
                {section(t('instruct.localtemplate.title'))}
                <Toggle label={t('instruct.localtemplate.label')} value={!!useTemplate} onValueChange={setUseTemplate} />
            </ScrollView>
        </View>
    )
}

const styles = {
    container: { flex: 1, backgroundColor: '#101010', paddingTop: 12 } as const,
    content: { padding: 16, paddingBottom: 48 } as const,
    title: { color: '#FFFFFF', fontSize: 22, fontWeight: '700' as const, paddingHorizontal: 16, paddingBottom: 12 },
    section: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' as const, marginTop: 24, marginBottom: 10 },
    field: { marginBottom: 14 },
    label: { color: '#DDDDDD', fontSize: 14, marginBottom: 6 },
    input: { color: '#FFFFFF', backgroundColor: '#242424', borderColor: '#444444', borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, minHeight: 42 },
    multiline: { minHeight: 92 },
    toggleRow: { minHeight: 48, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, borderBottomWidth: 1, borderBottomColor: '#303030', paddingVertical: 5 },
    toggleLabel: { color: '#EEEEEE', flex: 1, paddingRight: 12 },
    preset: { padding: 12, borderRadius: 8, backgroundColor: '#242424', marginBottom: 6 },
    selectedPreset: { borderWidth: 1, borderColor: '#8AA8FF' },
    presetText: { color: '#FFFFFF' },
    actions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginTop: 10 },
    action: { backgroundColor: '#343434', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8 },
    destructiveAction: { backgroundColor: '#633333' },
    actionText: { color: '#FFFFFF', fontSize: 13 },
    help: { color: '#AAAAAA', marginBottom: 10, paddingHorizontal: 16 },
}

export default IndependentFormattingManager
