# Meson Format Action

`meson-format-action` is a GitHub Action (GHA) to check if meson files are correctly formatted.

## Usage

```yaml
  - uses: Totto16/meson-format-action@v1
    with:
      format-file: ./meson.format
      only-git-files: true
```

### Options

#### format-file

* Type: `string`
* Default: `""`
* Optional

The config file to use, if this is empty (the default) no config file is used, so meson default settings apply.

#### only-git-files

* Type: `boolean`
* Default: `false`
* Optional

If set to true, only meson files, that are checked into git are checked. This is helpfull, if you have subprojects, that you configured before running this action, so that these meson files don't get checked.

## Notes

- This action can only be run on ubuntu runners for now.
- This action can be used standalone, meson is installed as part of the action, but you also can run it after some other checks and manually installing meson
